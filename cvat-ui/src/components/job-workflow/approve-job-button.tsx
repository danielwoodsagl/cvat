// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useHistory } from 'react-router';
import Button from 'antd/lib/button';
import Modal from 'antd/lib/modal';
import Text from 'antd/lib/typography/Text';
import notification from 'antd/lib/notification';
import { CheckCircleOutlined } from '@ant-design/icons';

import CVATTooltip from 'components/common/cvat-tooltip';
import { CombinedState } from 'reducers';
import { saveAnnotationsAsync } from 'actions/annotation-actions';
import { updateJobAsync } from 'actions/jobs-actions';
import { Job, JobStage, JobState } from 'cvat-core-wrapper';
import {
    UserOption, getJobPeople, returnFlaggedFrames, setJobPeople,
} from './api';
import UserSelect from './user-select';

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Approves a job from the review screen. Frames with open issues go back to the annotator
// as a new job, and the rest of the job is accepted, in one step.
function ApproveJobButton(): JSX.Element | null {
    const dispatch = useDispatch();
    const history = useHistory();
    const job = useSelector((state: CombinedState) => state.annotation.job.instance) as Job | null;
    const issues = useSelector((state: CombinedState) => state.review.issues);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [annotator, setAnnotator] = useState<UserOption | null>(null);

    const flaggedFrames = new Set(
        issues.filter((issue: any) => !issue.resolved).map((issue: any) => issue.frame),
    );

    useEffect(() => {
        if (!open || !job) return;
        // Frames go back to whoever annotated the job, unless the reviewer picks someone else
        getJobPeople([job.id])
            .then((people) => setAnnotator(people[job.id]?.annotator ?? null))
            .catch(() => setAnnotator(null));
    }, [open]);

    if (!job || job.stage !== JobStage.VALIDATION) {
        return null;
    }

    const finish = (): void => {
        setOpen(false);
        history.push('/board');
    };

    const onApprove = async (): Promise<void> => {
        setBusy(true);
        try {
            await dispatch(saveAnnotationsAsync());
            if (flaggedFrames.size) {
                const returned = await returnFlaggedFrames(job.id, annotator ? annotator.id : null);
                notification.success({
                    message: `Job ${job.id} approved`,
                    description: `${flaggedFrames.size} flagged frame${flaggedFrames.size === 1 ? '' : 's'} sent back as job ${returned.id}` +
                        `${returned.assignee ? ` to ${returned.assignee.username}` : ' (not assigned yet)'}.`,
                    className: 'cvat-notification-approve-job-done',
                });
            } else {
                // Keep the reviewer on record once the job leaves the review stage
                await setJobPeople(job.id, {}).catch(() => null);
                await dispatch(updateJobAsync(job, { stage: JobStage.ACCEPTANCE, state: JobState.COMPLETED }));
                notification.success({
                    message: `Job ${job.id} approved`,
                    className: 'cvat-notification-approve-job-done',
                });
            }
            finish();
        } catch (error: unknown) {
            notification.error({
                message: 'Could not approve the job',
                description: errorText(error),
                className: 'cvat-notification-approve-job-failed',
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <CVATTooltip overlay='Approve this job. Frames with open issues go back to the annotator.'>
                <Button
                    type='link'
                    className='cvat-annotation-header-approve-button cvat-annotation-header-button'
                    onClick={() => setOpen(true)}
                >
                    <CheckCircleOutlined />
                    Approve
                </Button>
            </CVATTooltip>
            {open && (
                <Modal
                    open
                    className='cvat-modal-approve-job'
                    title={`Approve job ${job.id}`}
                    okText={flaggedFrames.size ? 'Approve and send back' : 'Approve'}
                    okButtonProps={{ loading: busy }}
                    onOk={onApprove}
                    onCancel={() => setOpen(false)}
                    destroyOnClose
                >
                    {flaggedFrames.size ? (
                        <>
                            <Text>
                                {`${flaggedFrames.size} frame${flaggedFrames.size === 1 ? ' has' : 's have'} open issues. `}
                                Those frames go back as a new job, and the rest of this job is accepted.
                            </Text>
                            <div style={{ marginTop: 12 }}>
                                <Text strong>Send back to</Text>
                                <div style={{ marginTop: 4 }}>
                                    <UserSelect
                                        className='cvat-approve-job-annotator'
                                        placeholder='Choose the annotator'
                                        value={annotator}
                                        onChange={setAnnotator}
                                    />
                                </div>
                            </div>
                        </>
                    ) : (
                        <Text>No frames have open issues. The whole job moves to Accepted.</Text>
                    )}
                </Modal>
            )}
        </>
    );
}

export default React.memo(ApproveJobButton);
