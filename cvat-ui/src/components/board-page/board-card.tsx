// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useCallback } from 'react';
import { useHistory } from 'react-router';
import Card from 'antd/lib/card';
import Text from 'antd/lib/typography/Text';
import dayjs from 'dayjs';

import { Job } from 'cvat-core-wrapper';
import JobStageStateBadges from 'components/job-item/job-status-visuals';

interface Props {
    job: Job;
}

function BoardCardComponent({ job }: Readonly<Props>): JSX.Element {
    const history = useHistory();

    const onClick = useCallback((event: React.MouseEvent): void => {
        const url = `/tasks/${job.taskId}/jobs/${job.id}`;
        if (event.ctrlKey || event.metaKey) {
            window.open(url, '_blank', 'noopener noreferrer');
        } else {
            history.push(url);
        }
    }, [job.id, job.taskId]);

    return (
        <Card
            hoverable
            size='small'
            className='cvat-board-card'
            onClick={onClick}
        >
            <Text strong ellipsis={{ tooltip: job.taskName }} className='cvat-board-card-title'>
                {job.taskName ?? `Task ${job.taskId}`}
            </Text>
            <div className='cvat-board-card-meta'>
                <Text type='secondary'>{`Job ${job.id}`}</Text>
                <Text type='secondary'>{`${job.frameCount ?? job.stopFrame - job.startFrame + 1} frames`}</Text>
            </div>
            <div className='cvat-board-card-status'>
                <JobStageStateBadges stage={job.stage} state={job.state} />
            </div>
            <div className='cvat-board-card-footer'>
                <Text type='secondary'>{job.assignee ? job.assignee.username : 'Nobody'}</Text>
                <Text type='secondary'>{dayjs(job.updatedDate).fromNow()}</Text>
            </div>
        </Card>
    );
}

export default React.memo(BoardCardComponent);
