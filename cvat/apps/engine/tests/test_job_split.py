# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from unittest import mock

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from rest_framework import status

from cvat.apps.engine.job_split import even_chunks
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

User = get_user_model()


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


class JobSplitBetweenPeopleAPITestCase(ApiTestBase):
    @classmethod
    def setUpTestData(cls):
        create_db_users(cls)

    def setUp(self):
        super().setUp()

        self.task = create_dummy_db_tasks(self)[0]
        self.job = Job.objects.get(segment__task_id=self.task.id)
        self.label = Label.objects.create(task=self.task, name="dent")

        # A pre-label on each of frames 0, 40 and 99, and an issue on frame 70
        for frame in (0, 40, 99):
            LabeledShape.objects.create(
                job=self.job,
                label=self.label,
                frame=frame,
                group=0,
                type="rectangle",
                points=[1, 2, 3, 4],
            )
        Issue.objects.create(job=self.job, frame=70, position=[1, 2, 3, 4], owner=self.owner)

        self.people = [self.owner.id, self.assignee.id, self.annotator.id]

    def _post(self, user, assignees, job_id=None):
        with ForceLogin(user, self.client):
            return self.client.post(
                f"/api/jobs/{job_id or self.job.id}/split",
                data={"assignees": assignees},
                format="json",
            )

    @staticmethod
    def _frames_of(job: Job) -> list[int]:
        job.segment.refresh_from_db()
        start = job.segment.task.data.start_frame
        return sorted(frame - start for frame in job.segment.frame_set)

    def test_splits_frames_evenly_in_order_of_people(self):
        response = self._post(self.admin, self.people)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        jobs = [Job.objects.get(pk=item["id"]) for item in response.data]
        self.assertEqual(jobs[0].id, self.job.id)
        self.assertEqual([j.assignee_id for j in jobs], self.people)
        self.assertEqual([len(self._frames_of(j)) for j in jobs], [34, 33, 33])
        self.assertEqual(self._frames_of(jobs[0]), list(range(0, 34)))
        self.assertEqual(self._frames_of(jobs[1]), list(range(34, 67)))
        self.assertEqual(self._frames_of(jobs[2]), list(range(67, 100)))
        for job in jobs:
            self.assertEqual(job.stage, StageChoice.ANNOTATION)
            self.assertEqual(job.type, JobType.ANNOTATION)

    def test_moves_pre_labels_and_issues_with_their_frames(self):
        jobs = [item["id"] for item in self._post(self.admin, self.people).data]

        def frames_of_shapes(job_id):
            return set(LabeledShape.objects.filter(job_id=job_id).values_list("frame", flat=True))

        self.assertEqual(frames_of_shapes(jobs[0]), {0})
        self.assertEqual(frames_of_shapes(jobs[1]), {40})
        self.assertEqual(frames_of_shapes(jobs[2]), {99})
        self.assertEqual(Issue.objects.get(frame=70).job_id, jobs[2])

    def test_owner_can_split(self):
        self.assertEqual(self._post(self.owner, self.people).status_code, status.HTTP_201_CREATED)

    def test_drops_the_original_jobs_cached_chunks(self):
        # Chunks cached before the split hold the old frames; keeping them leaves the job
        # unable to load its images
        with (
            mock.patch("cvat.apps.engine.cache.MediaCache.remove_segments_chunks") as remove,
            mock.patch("cvat.apps.engine.cache.MediaCache.remove_segment_preview") as preview,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self._post(self.admin, self.people)

        removed = remove.call_args.args[0]
        self.assertTrue(removed)
        self.assertTrue(all(item["db_segment"].id == self.job.segment_id for item in removed))
        self.assertIn(0, {item["chunk_number"] for item in removed})
        preview.assert_called_once()

    def test_annotator_cannot_split(self):
        response = self._post(self.annotator, self.people)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Job.objects.filter(segment__task_id=self.task.id).count(), 1)

    def test_needs_at_least_two_people(self):
        self.assertEqual(
            self._post(self.admin, [self.owner.id]).status_code, status.HTTP_400_BAD_REQUEST
        )

    def test_rejects_the_same_person_twice(self):
        response = self._post(self.admin, [self.owner.id, self.owner.id])

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_rejects_unknown_people(self):
        response = self._post(self.admin, [self.owner.id, 999999])

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_only_annotation_stage_jobs_can_be_split(self):
        self.job.stage = StageChoice.VALIDATION
        self.job.save()

        response = self._post(self.admin, self.people)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Job.objects.filter(segment__task_id=self.task.id).count(), 1)

    def test_rejects_more_people_than_frames(self):
        first = self._post(self.admin, self.people).data[1]["id"]

        # 33 frames left in this job, so 34 people is too many
        many = [User.objects.create_user(username=f"extra{i}", password="x").id for i in range(34)]
        response = self._post(self.admin, many, job_id=first)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_split_job_can_be_split_again(self):
        second = self._post(self.admin, self.people).data[1]["id"]

        response = self._post(self.admin, [self.owner.id, self.user.id], job_id=second)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        parts = [self._frames_of(Job.objects.get(pk=item["id"])) for item in response.data]
        self.assertEqual(parts, [list(range(34, 51)), list(range(51, 67))])


class EvenChunksTest(SimpleTestCase):
    def test_sizes_differ_by_at_most_one_and_keep_order(self):
        self.assertEqual(even_chunks(list(range(10)), 3), [[0, 1, 2, 3], [4, 5, 6], [7, 8, 9]])
        self.assertEqual(even_chunks(list(range(200)), 4)[3], list(range(150, 200)))
