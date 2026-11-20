// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import Button from 'antd/lib/button';
import InputNumber from 'antd/lib/input-number';
import Modal from 'antd/lib/modal';
import Text from 'antd/lib/typography/Text';
import notification from 'antd/lib/notification';
import { TeamOutlined } from '@ant-design/icons';

import { Job, getCore } from 'cvat-core-wrapper';
import { jobsActions } from 'actions/jobs-actions';
import { BoardColumnConfig, BoardFilters, buildColumnFilter } from './board-config';

const core = getCore();

export const MAX_ALLOCATE = 500;

interface Props {
    column: BoardColumnConfig;
    filters: BoardFilters;
    available: number;
}

// Picks the oldest jobs waiting in a column and opens the dialog that shares them between people
function AllocateButton({ column, filters, available }: Readonly<Props>): JSX.Element {
    const dispatch = useDispatch();
    const [open, setOpen] = useState(false);
    const [count, setCount] = useState(20);
    const [loading, setLoading] = useState(false);
    const most = Math.min(available, MAX_ALLOCATE);

    const onNext = async (): Promise<void> => {
        setLoading(true);
        try {
            const query = {
                page: 1,
                pageSize: Math.min(count, most),
                sort: 'id',
                filter: buildColumnFilter(column, filters),
            };
            const jobs = await core.jobs.get(query);
            setOpen(false);
            dispatch(jobsActions.openDistributeJobsModal([...jobs] as Job[]));
        } catch (error: unknown) {
            notification.error({
                message: 'Could not load the jobs to allocate',
                description: error instanceof Error ? error.message : String(error),
                className: 'cvat-notification-board-allocate-failed',
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Button
                size='small'
                icon={<TeamOutlined />}
                className='cvat-board-allocate-button'
                disabled={available === 0}
                onClick={() => {
                    setCount(Math.min(20, most));
                    setOpen(true);
                }}
            >
                Allocate
            </Button>
            {open && (
                <Modal
                    open
                    className='cvat-modal-board-allocate'
                    title='Allocate jobs'
                    okText='Next: choose people'
                    okButtonProps={{ loading, disabled: !count }}
                    onOk={onNext}
                    onCancel={() => setOpen(false)}
                    destroyOnClose
                >
                    <Text>
                        {`How many of the ${available} waiting jobs${filters.projectId !== null ? ' in this project' : ''} `}
                        do you want to hand out? The oldest go first.
                    </Text>
                    <div style={{ marginTop: 12 }}>
                        <InputNumber
                            className='cvat-board-allocate-count'
                            min={1}
                            max={most}
                            value={count}
                            onChange={(value: number | null) => setCount(value ?? 0)}
                        />
                        <Text type='secondary' style={{ marginLeft: 8 }}>{`up to ${most}`}</Text>
                    </div>
                </Modal>
            )}
        </>
    );
}

export default React.memo(AllocateButton);
