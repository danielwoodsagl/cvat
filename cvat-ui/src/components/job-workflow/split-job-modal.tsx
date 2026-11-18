// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useEffect, useMemo, useState } from 'react';
import Modal from 'antd/lib/modal';
import Select from 'antd/lib/select';
import Text from 'antd/lib/typography/Text';
import notification from 'antd/lib/notification';

import { Job } from 'cvat-core-wrapper';
import { UserOption, searchUsers, splitJobBetween } from './api';

interface Props {
    job: Job;
    onClose: () => void;
    onDone: () => void;
}

function sizes(total: number, parts: number): number[] {
    const base = Math.floor(total / parts);
    const extra = total % parts;
    return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

function SplitJobModal({ job, onClose, onDone }: Readonly<Props>): JSX.Element {
    const [options, setOptions] = useState<UserOption[]>([]);
    const [chosen, setChosen] = useState<UserOption[]>([]);
    const [saving, setSaving] = useState(false);
    const frames = job.frameCount ?? (job.stopFrame - job.startFrame + 1);

    const load = (search: string): void => {
        searchUsers(search).then(setOptions).catch(() => setOptions([]));
    };

    useEffect(() => load(''), []);

    const preview = useMemo(() => {
        if (chosen.length < 2) return null;
        const parts = sizes(frames, chosen.length);
        return chosen.map((user, i) => `${user.username}: ${parts[i]}`).join(', ');
    }, [chosen, frames]);

    const tooMany = chosen.length > frames;

    const onOk = async (): Promise<void> => {
        setSaving(true);
        try {
            const jobs = await splitJobBetween(job.id, chosen.map((user) => user.id));
            notification.success({
                message: `Job ${job.id} split into ${jobs.length} jobs`,
                description: preview,
                className: 'cvat-notification-split-job-done',
            });
            onDone();
        } catch (error: unknown) {
            notification.error({
                message: 'Could not split the job',
                description: error instanceof Error ? error.message : String(error),
                className: 'cvat-notification-split-job-failed',
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open
            className='cvat-modal-split-job'
            title={`Split job ${job.id} between people`}
            okText='Split'
            okButtonProps={{ disabled: chosen.length < 2 || tooMany, loading: saving }}
            onOk={onOk}
            onCancel={onClose}
            destroyOnClose
        >
            <Text>
                {`This job has ${frames} frames. Choose who to share it with, in order. `}
                Each person gets an equal run of frames, with any pre-labels on them.
            </Text>
            <Select
                mode='multiple'
                showSearch
                allowClear
                className='cvat-split-job-users'
                style={{ width: '100%', margin: '12px 0' }}
                placeholder='Choose at least two people'
                filterOption={false}
                onSearch={load}
                value={chosen.map((user) => user.id)}
                options={options.map((user) => ({ value: user.id, label: user.username }))}
                onChange={(ids: number[]) => {
                    const known = new Map([...options, ...chosen].map((user) => [user.id, user]));
                    setChosen(ids.map((id) => known.get(id)).filter(Boolean) as UserOption[]);
                }}
            />
            {preview && !tooMany && <Text type='secondary'>{`Frames each: ${preview}`}</Text>}
            {tooMany && <Text type='danger'>More people than frames. Choose fewer people.</Text>}
        </Modal>
    );
}

export default React.memo(SplitJobModal);
