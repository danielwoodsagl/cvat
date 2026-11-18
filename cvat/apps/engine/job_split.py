# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from __future__ import annotations

import math
from collections.abc import Collection, Sequence

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from cvat.apps.engine import models
from cvat.apps.engine.media_io.frame_provider import TaskFrameProvider


def _job_rel_frames(db_job: models.Job, frame_provider: TaskFrameProvider) -> set[int]:
    return {frame_provider.get_rel_frame_number(f) for f in db_job.segment.frame_set}


def _flagged_frames(db_job: models.Job, requested: Sequence[int] | None) -> set[int]:
    job_frames = _job_rel_frames(db_job, TaskFrameProvider(db_job.segment.task))

    if requested is None:
        flagged = set(
            db_job.issues.filter(resolved=False).values_list("frame", flat=True).distinct()
        )
    else:
        if len(set(requested)) != len(requested):
            raise ValidationError("Frames must not repeat")

        flagged = set(requested)

    outside = flagged - job_frames
    if outside:
        raise ValidationError(
            "The following frames are not in this job: {}".format(
                ", ".join(map(str, sorted(outside)))
            )
        )

    return flagged


def _check_can_split(db_job: models.Job) -> None:
    if db_job.type != models.JobType.ANNOTATION:
        raise ValidationError("Only annotation jobs can be split")

    if db_job.stage not in (models.StageChoice.VALIDATION, models.StageChoice.ACCEPTANCE):
        raise ValidationError("A job can only be split during the validation or acceptance stage")

    if db_job.parent_job_id is not None or db_job.child_jobs.exists():
        raise ValidationError("Jobs that are part of a consensus set cannot be split")

    # Tracks and intervals span frames, so they cannot be divided between two
    # jobs without changing what they mean.
    if db_job.labeledtrack_set.exists() or db_job.labeledinterval_set.exists():
        raise ValidationError(
            "Jobs containing tracks or intervals cannot be split, "
            "only jobs with shapes and tags are supported"
        )


@transaction.atomic
def return_flagged_frames(
    job_id: int,
    *,
    frames: Sequence[int] | None = None,
    assignee_id: int | None = None,
) -> models.Job:
    """
    Accepts the frames of a job that passed review and sends the rest back as a new job.

    Frames are the task-relative numbers used by annotations and issues. By default
    these are the frames that have unresolved issues. The flagged frames, their
    annotations and their issues move to a new annotation job in the same task.
    The original job keeps the remaining frames and is marked as accepted.

    Returns the new job.
    """

    db_job = (
        models.Job.objects.select_for_update(of=("self",))
        .select_related("segment", "segment__task", "segment__task__data")
        .get(pk=job_id)
    )

    _check_can_split(db_job)

    db_segment = db_job.segment
    db_task = db_segment.task
    frame_provider = TaskFrameProvider(db_task)

    job_frames = _job_rel_frames(db_job, frame_provider)
    flagged = _flagged_frames(db_job, frames)

    if not flagged:
        raise ValidationError(
            "There are no frames to send back. Raise issues on the frames that need "
            "rework, or pass the frames explicitly"
        )

    kept = job_frames - flagged
    if not kept:
        raise ValidationError(
            "Every frame in this job is flagged. Reject the whole job instead of splitting it"
        )

    _move_frames(
        db_job,
        flagged=flagged,
        kept=kept,
        frame_provider=frame_provider,
    )

    db_new_job = _create_job_for_frames(
        db_job,
        frames=flagged,
        frame_provider=frame_provider,
        assignee_id=assignee_id,
    )

    _move_annotations_and_issues(db_job, db_new_job, flagged)
    _mark_accepted(db_job)

    return db_new_job


def _move_frames(
    db_job: models.Job,
    *,
    flagged: Collection[int],
    kept: Collection[int],
    frame_provider: TaskFrameProvider,
) -> None:
    "Restricts the original segment to the frames that were not flagged"

    db_segment = db_job.segment
    old_frame_count = db_segment.frame_count

    db_segment.type = models.SegmentType.SPECIFIC_FRAMES
    db_segment.frames = sorted(map(frame_provider.get_abs_frame_number, kept))
    db_segment.chunks_updated_date = timezone.now()
    db_segment.save()

    # Chunks cached before the change hold the old frames and are now older than
    # chunks_updated_date, so they would be refused rather than rebuilt. Drop them, once the
    # change is committed, so a request cannot re-cache the old frames in between.
    transaction.on_commit(lambda: _drop_cached_chunks(db_segment, old_frame_count))


def _drop_cached_chunks(db_segment: models.Segment, frame_count: int) -> None:
    from cvat.apps.engine.cache import MediaCache

    chunk_size = db_segment.task.data.chunk_size or 1
    chunk_count = max(1, math.ceil(frame_count / chunk_size))

    cache = MediaCache()
    cache.remove_segment_preview(db_segment)
    cache.remove_segments_chunks(
        [
            {"db_segment": db_segment, "chunk_number": chunk_number, "quality": quality}
            for quality in (models.FrameQuality.COMPRESSED, models.FrameQuality.ORIGINAL)
            for chunk_number in range(chunk_count)
        ]
    )


def _create_job_for_frames(
    db_job: models.Job,
    *,
    frames: Collection[int],
    frame_provider: TaskFrameProvider,
    assignee_id: int | None,
    state: models.StateChoice = models.StateChoice.REJECTED,
) -> models.Job:
    db_task = db_job.segment.task

    db_segment = models.Segment.objects.create(
        task=db_task,
        start_frame=0,
        stop_frame=db_task.data.size - 1,
        type=models.SegmentType.SPECIFIC_FRAMES,
        frames=sorted(map(frame_provider.get_abs_frame_number, frames)),
    )

    db_new_job = models.Job.objects.create(
        segment=db_segment,
        type=models.JobType.ANNOTATION,
        stage=models.StageChoice.ANNOTATION,
        state=state,
        status=models.StatusChoice.ANNOTATION,
        assignee_id=assignee_id,
    )

    if assignee_id is not None:
        db_new_job.assignee_updated_date = db_new_job.updated_date
        db_new_job.save(update_fields=["assignee_updated_date"])

    db_new_job.make_dirs()

    return db_new_job


def _move_annotations_and_issues(
    db_job: models.Job, db_new_job: models.Job, flagged: Collection[int]
) -> None:
    "Attribute values hang off their annotation, so only the annotation rows are re-pointed"

    for annotation_set in (db_job.labeledimage_set, db_job.labeledshape_set):
        annotation_set.filter(frame__in=flagged).update(job=db_new_job)

    db_job.issues.filter(frame__in=flagged).update(job=db_new_job)


def _mark_accepted(db_job: models.Job) -> None:
    db_job.stage = models.StageChoice.ACCEPTANCE
    db_job.state = models.StateChoice.COMPLETED
    db_job.status = models.StatusChoice.COMPLETED
    db_job.save(update_fields=["stage", "state", "status"])


def _check_can_divide(db_job: models.Job) -> None:
    if db_job.type != models.JobType.ANNOTATION:
        raise ValidationError("Only annotation jobs can be split")

    if db_job.stage != models.StageChoice.ANNOTATION:
        raise ValidationError("Only jobs in the annotation stage can be split between people")

    if db_job.parent_job_id is not None or db_job.child_jobs.exists():
        raise ValidationError("Jobs that are part of a consensus set cannot be split")

    if db_job.labeledtrack_set.exists() or db_job.labeledinterval_set.exists():
        raise ValidationError(
            "Jobs containing tracks or intervals cannot be split, "
            "only jobs with shapes and tags are supported"
        )


def even_chunks(frames: Sequence[int], parts: int) -> list[list[int]]:
    "Splits sorted frames into `parts` contiguous runs whose sizes differ by at most one"

    size, extra = divmod(len(frames), parts)
    chunks, start = [], 0
    for i in range(parts):
        end = start + size + (1 if i < extra else 0)
        chunks.append(list(frames[start:end]))
        start = end
    return chunks


@transaction.atomic
def split_between(job_id: int, *, assignee_ids: Sequence[int]) -> list[models.Job]:
    """
    Divides an annotation job between several people.

    The job's frames are split into equal, contiguous runs, one per person, in the order the
    people are given. The original job keeps the first run and is assigned to the first person.
    Every other run becomes a new job in the same task, with its annotations and issues.

    Returns the jobs in assignee order, the original job first.
    """

    if len(assignee_ids) < 2:
        raise ValidationError("Choose at least two people to split a job between")

    if len(set(assignee_ids)) != len(assignee_ids):
        raise ValidationError("Each person can only be chosen once")

    db_job = (
        models.Job.objects.select_for_update(of=("self",))
        .select_related("segment", "segment__task", "segment__task__data")
        .get(pk=job_id)
    )

    _check_can_divide(db_job)

    frame_provider = TaskFrameProvider(db_job.segment.task)
    frames = sorted(_job_rel_frames(db_job, frame_provider))
    if len(frames) < len(assignee_ids):
        raise ValidationError(
            f"This job has {len(frames)} frames, too few to split between "
            f"{len(assignee_ids)} people"
        )

    first, *rest = even_chunks(frames, len(assignee_ids))

    _move_frames(db_job, flagged=[], kept=first, frame_provider=frame_provider)

    jobs = [db_job]
    for chunk, assignee_id in zip(rest, assignee_ids[1:]):
        db_new_job = _create_job_for_frames(
            db_job,
            frames=chunk,
            frame_provider=frame_provider,
            assignee_id=assignee_id,
            state=models.StateChoice.NEW,
        )
        _move_annotations_and_issues(db_job, db_new_job, chunk)
        jobs.append(db_new_job)

    db_job.update_assignee(assignee_ids[0])
    db_job.save(update_fields=["assignee", "assignee_updated_date"])

    return jobs
