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
import { SendOutlined } from '@ant-design/icons';

import CVATTooltip from 'components/common/cvat-tooltip';
import { CombinedState } from 'reducers';
import { saveAnnotationsAsync } from 'actions/annotation-actions';
import { Job, JobStage } from 'cvat-core-wrapper';
import {
    UserOption, displayName, getJobPeople, sendToReview,
} from './api';
import UserSelect from './user-select';

// Saves the job, moves it to the review stage and hands it to the reviewer, in one step
function SendToReviewButton(): JSX.Element | null {
    const dispatch = useDispatch();
    const history = useHistory();
    const job = useSelector((state: CombinedState) => state.annotation.job.instance) as Job | null;
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [reviewer, setReviewer] = useState<UserOption | null>(null);

    useEffect(() => {
        if (!open || !job) return;
        getJobPeople([job.id])
            .then((people) => setReviewer(people[job.id]?.reviewer ?? null))
            .catch(() => setReviewer(null));
    }, [open]);

    if (!job || job.stage !== JobStage.ANNOTATION) {
        return null;
    }

    const onSend = async (): Promise<void> => {
        setBusy(true);
        try {
            await dispatch(saveAnnotationsAsync());
            await sendToReview(job.id, reviewer ? reviewer.id : null);
            notification.success({
                message: `Job ${job.id} sent to review`,
                description: reviewer ? `It is now with ${displayName(reviewer)}.` : 'No reviewer is assigned yet.',
                className: 'cvat-notification-send-to-review-done',
            });
            setOpen(false);
            history.push('/board');
        } catch (error: unknown) {
            notification.error({
                message: 'Could not send the job to review',
                description: error instanceof Error ? error.message : String(error),
                className: 'cvat-notification-send-to-review-failed',
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <CVATTooltip overlay='Save this job and send it to review'>
                <Button
                    type='link'
                    className='cvat-annotation-header-send-to-review-button cvat-annotation-header-button'
                    onClick={() => setOpen(true)}
                >
                    <SendOutlined />
                    Send to Review
                </Button>
            </CVATTooltip>
            {open && (
                <Modal
                    open
                    className='cvat-modal-send-to-review'
                    title={`Send job ${job.id} to review`}
                    okText='Send to review'
                    okButtonProps={{ loading: busy }}
                    onOk={onSend}
                    onCancel={() => setOpen(false)}
                    destroyOnClose
                >
                    <Text>Your work is saved and the job moves to the Review column.</Text>
                    <div style={{ marginTop: 12 }}>
                        <Text strong>Reviewer</Text>
                        <div style={{ marginTop: 4 }}>
                            <UserSelect
                                className='cvat-send-to-review-reviewer'
                                placeholder='Choose the reviewer (or leave it for a lead to assign)'
                                value={reviewer}
                                onChange={setReviewer}
                            />
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
}

export default React.memo(SendToReviewButton);
