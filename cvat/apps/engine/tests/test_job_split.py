# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from rest_framework import status

from cvat.apps.engine.models import (
    Issue,
    Job,
    JobType,
    Label,
    LabeledImage,
    LabeledShape,
    LabeledTrack,
    SegmentType,
    StageChoice,
    StateChoice,
    StatusChoice,
)
from cvat.apps.engine.tests.test_rest_api import create_db_users, create_dummy_db_tasks
from cvat.apps.engine.tests.utils import ApiTestBase, ForceLogin


class JobReturnFlaggedFramesAPITestCase(ApiTestBase):
    @classmethod
    def setUpTestData(cls):
        create_db_users(cls)

    def setUp(self):
        super().setUp()

        self.task = create_dummy_db_tasks(self)[0]
        self.job = Job.objects.get(segment__task_id=self.task.id)
        self.job.stage = StageChoice.VALIDATION
        self.job.state = StateChoice.IN_PROGRESS
        self.job.status = StatusChoice.VALIDATION
        self.job.assignee = self.annotator
        self.job.save()

        self.label = Label.objects.create(task=self.task, name="dent")

        # Two shapes on frame 3, one on frame 4 and a tag on frame 10
        for frame in (3, 3, 4):
            self._add_shape(frame, points=[1, 2, 3, 4])
        self.tag = LabeledImage.objects.create(job=self.job, label=self.label, frame=10, group=0)

        self.issue_open = self._add_issue(frame=3, resolved=False)
        self.issue_resolved = self._add_issue(frame=10, resolved=True)

    def _add_shape(self, frame: int, *, points: list[float]) -> LabeledShape:
        return LabeledShape.objects.create(
            job=self.job,
            label=self.label,
            frame=frame,
            group=0,
            type="rectangle",
            points=points,
        )

    def _add_issue(self, *, frame: int, resolved: bool) -> Issue:
        return Issue.objects.create(
            job=self.job, frame=frame, position=[1, 2, 3, 4], owner=self.owner, resolved=resolved
        )

    def _post(self, user, data=None, job_id=None):
        with ForceLogin(user, self.client):
            return self.client.post(
                f"/api/jobs/{job_id or self.job.id}/return_flagged_frames",
                data=data or {},
                format="json",
            )

    def _frames_of(self, job: Job) -> set[int]:
        job.refresh_from_db()
        job.segment.refresh_from_db()
        return {frame - job.segment.task.data.start_frame for frame in job.segment.frame_set}

    def test_sends_back_frames_with_unresolved_issues(self):
        response = self._post(self.admin)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        new_job = Job.objects.get(pk=response.data["id"])

        self.assertEqual(new_job.type, JobType.ANNOTATION)
        self.assertEqual(new_job.stage, StageChoice.ANNOTATION)
        self.assertEqual(new_job.state, StateChoice.REJECTED)
        self.assertIsNone(new_job.assignee)
        self.assertEqual(new_job.segment.type, SegmentType.SPECIFIC_FRAMES)
        self.assertEqual(new_job.segment.task_id, self.task.id)
        self.assertEqual(self._frames_of(new_job), {3})

        self.job.refresh_from_db()
        self.assertEqual(self.job.stage, StageChoice.ACCEPTANCE)
        self.assertEqual(self.job.state, StateChoice.COMPLETED)
        self.assertEqual(self.job.status, StatusChoice.COMPLETED)
        self.assertEqual(self.job.segment.type, SegmentType.SPECIFIC_FRAMES)
        self.assertEqual(self._frames_of(self.job), set(range(100)) - {3})

    def test_moves_annotations_and_issues_with_their_frame(self):
        new_job_id = self._post(self.admin).data["id"]

        frames_in_new_job = set(
            LabeledShape.objects.filter(job_id=new_job_id).values_list("frame", flat=True)
        )
        self.assertEqual(frames_in_new_job, {3})
        self.assertEqual(LabeledShape.objects.filter(job_id=new_job_id).count(), 2)

        frames_left = set(
            LabeledShape.objects.filter(job_id=self.job.id).values_list("frame", flat=True)
        )
        self.assertEqual(frames_left, {4})
        self.assertEqual(LabeledImage.objects.get(pk=self.tag.pk).job_id, self.job.id)

        self.issue_open.refresh_from_db()
        self.issue_resolved.refresh_from_db()
        self.assertEqual(self.issue_open.job_id, new_job_id)
        self.assertEqual(self.issue_resolved.job_id, self.job.id)

    def test_explicit_frames_and_assignee(self):
        response = self._post(self.admin, {"frames": [4, 10], "assignee": self.assignee.id})

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        new_job = Job.objects.get(pk=response.data["id"])
        self.assertEqual(self._frames_of(new_job), {4, 10})
        self.assertEqual(new_job.assignee_id, self.assignee.id)
        self.assertTrue(LabeledImage.objects.filter(pk=self.tag.pk, job=new_job).exists())

    def test_owner_can_split(self):
        self.assertEqual(self._post(self.owner).status_code, status.HTTP_201_CREATED)

    def test_annotator_cannot_split(self):
        response = self._post(self.annotator)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Job.objects.filter(segment__task_id=self.task.id).count(), 1)

    def test_unrelated_user_cannot_split(self):
        self.assertEqual(self._post(self.somebody).status_code, status.HTTP_403_FORBIDDEN)

    def test_anonymous_user_cannot_split(self):
        self.assertEqual(self._post(None).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_rejects_job_in_annotation_stage(self):
        self.job.stage = StageChoice.ANNOTATION
        self.job.save()

        self.assertEqual(self._post(self.admin).status_code, status.HTTP_400_BAD_REQUEST)

    def test_rejects_when_nothing_is_flagged(self):
        Issue.objects.filter(job=self.job).update(resolved=True)

        response = self._post(self.admin)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Job.objects.filter(segment__task_id=self.task.id).count(), 1)

    def test_rejects_when_every_frame_is_flagged(self):
        response = self._post(self.admin, {"frames": list(range(100))})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Job.objects.filter(segment__task_id=self.task.id).count(), 1)

    def test_rejects_frames_outside_the_job(self):
        self.assertEqual(
            self._post(self.admin, {"frames": [3, 500]}).status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    def test_rejects_repeated_frames(self):
        self.assertEqual(
            self._post(self.admin, {"frames": [3, 3]}).status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    def test_rejects_unknown_assignee(self):
        self.assertEqual(
            self._post(self.admin, {"frames": [3], "assignee": 999999}).status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    def test_rejects_job_with_tracks(self):
        LabeledTrack.objects.create(job=self.job, label=self.label, frame=3, group=0)

        response = self._post(self.admin)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Job.objects.filter(segment__task_id=self.task.id).count(), 1)

    def test_failed_split_leaves_the_job_unchanged(self):
        self._post(self.admin, {"frames": [3, 500]})

        self.job.refresh_from_db()
        self.assertEqual(self.job.stage, StageChoice.VALIDATION)
        self.assertEqual(LabeledShape.objects.filter(job=self.job).count(), 3)
        self.assertEqual(self.job.segment.type, SegmentType.RANGE)

    def test_a_split_job_can_be_split_again(self):
        first = self._post(self.admin, {"frames": [3, 4]})
        second_job = Job.objects.get(pk=first.data["id"])
        second_job.stage = StageChoice.VALIDATION
        second_job.save()

        response = self._post(self.admin, {"frames": [4]}, job_id=second_job.id)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(self._frames_of(second_job), {3})
        self.assertEqual(self._frames_of(Job.objects.get(pk=response.data["id"])), {4})
