### Added

- A `POST /api/jobs/{id}/return_flagged_frames` endpoint that accepts a reviewed job
  and sends back only the frames that were flagged. The flagged frames (by default,
  those with unresolved issues), their annotations and their issues move to a new
  annotation job, and the original job keeps the remaining frames and is accepted.
  Jobs with tracks or intervals and consensus jobs are not supported
  (<https://github.com/cvat-ai/cvat/pull/XXXX>)
