// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import Avatar from 'antd/lib/avatar';
import Popover from 'antd/lib/popover';
import Text from 'antd/lib/typography/Text';
import notification from 'antd/lib/notification';

import CVATTooltip from 'components/common/cvat-tooltip';
import {
    JobPeople, UserOption, displayName, initials, setJobPeople,
} from 'components/job-workflow/api';
import UserSelect from 'components/job-workflow/user-select';

type Role = 'annotator' | 'reviewer';

const ROLE_TITLE: Record<Role, string> = {
    annotator: 'Annotator',
    reviewer: 'Reviewer',
};

function PersonBadge({ kind, user }: { kind: Role; user: UserOption | null }): JSX.Element {
    return (
        <CVATTooltip overlay={`${ROLE_TITLE[kind]}: ${user ? displayName(user) : 'nobody yet'}`}>
            <Avatar
                size='small'
                className={`cvat-board-card-person cvat-board-card-${kind}${user ? '' : ' cvat-board-card-person-empty'}`}
            >
                {user ? initials(user) : '?'}
            </Avatar>
        </CVATTooltip>
    );
}

interface Props {
    jobId: number;
    people: JobPeople | null;
    onChanged: () => void;
}

// The annotator and reviewer of a board card. Clicking them opens a menu to change either.
function JobPeopleBadges({ jobId, people, onChanged }: Readonly<Props>): JSX.Element {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState<Role | null>(null);

    const change = async (role: Role, user: UserOption | null): Promise<void> => {
        setSaving(role);
        try {
            await setJobPeople(jobId, { [role]: user ? user.id : null });
            notification.success({
                message: `${ROLE_TITLE[role]} of job ${jobId} ${user ? `set to ${displayName(user)}` : 'removed'}`,
                className: 'cvat-notification-job-people-changed',
            });
            onChanged();
        } catch (error: unknown) {
            notification.error({
                message: `Could not change the ${role}`,
                description: error instanceof Error ? error.message : String(error),
                className: 'cvat-notification-job-people-failed',
            });
        } finally {
            setSaving(null);
        }
    };

    const menu = (
        <div
            className='cvat-board-card-people-menu'
            onClick={(event) => event.stopPropagation()}
            role='presentation'
        >
            {(['annotator', 'reviewer'] as Role[]).map((role) => (
                <div key={role} className='cvat-board-card-people-menu-row'>
                    <Text strong>{ROLE_TITLE[role]}</Text>
                    <UserSelect
                        className={`cvat-board-card-${role}-select`}
                        placeholder={`Choose the ${role}`}
                        value={people ? people[role] : null}
                        disabled={saving !== null}
                        onChange={(user) => change(role, user)}
                    />
                </div>
            ))}
        </div>
    );

    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger='click'
            placement='bottomRight'
            title={`Who works on job ${jobId}`}
            content={menu}
            destroyTooltipOnHide
        >
            <span
                className='cvat-board-card-people'
                onClick={(event) => event.stopPropagation()}
                role='presentation'
            >
                <PersonBadge kind='annotator' user={people?.annotator ?? null} />
                <PersonBadge kind='reviewer' user={people?.reviewer ?? null} />
            </span>
        </Popover>
    );
}

export default React.memo(JobPeopleBadges);
