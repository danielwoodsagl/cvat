// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import './styles.scss';
import React, { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import Button from 'antd/lib/button';
import Input from 'antd/lib/input';
import Select from 'antd/lib/select';
import Text from 'antd/lib/typography/Text';

import { CombinedState } from 'reducers';
import { getCore } from 'cvat-core-wrapper';
import BoardColumnComponent from './board-column';
import { BOARD_COLUMNS, BoardFilters } from './board-config';

const core = getCore();

function BoardPageComponent(): JSX.Element {
    const username = useSelector((state: CombinedState) => state.auth.user?.username ?? null);
    const [assignee, setAssignee] = useState<string | null>(null);
    const [search, setSearch] = useState<string | null>(null);
    const [pendingSearch, setPendingSearch] = useState('');
    const [userOptions, setUserOptions] = useState<string[]>([]);
    const [projectId, setProjectId] = useState<number | null>(null);
    const [projectOptions, setProjectOptions] = useState<{ value: number; label: string }[]>([]);

    const filters = useMemo<BoardFilters>(
        () => ({ assignee, search, projectId }),
        [assignee, search, projectId],
    );

    const searchUsers = async (value: string): Promise<void> => {
        try {
            const users = await core.users.get({
                limit: 10,
                is_active: true,
                ...(value ? { search: value } : {}),
            });
            setUserOptions(users.map((user: { username: string }) => user.username));
        } catch (_error: unknown) {
            setUserOptions([]);
        }
    };

    const searchProjects = async (value: string): Promise<void> => {
        try {
            const projects = await core.projects.get({
                page: 1,
                pageSize: 10,
                sort: 'name',
                ...(value ? { search: value } : {}),
            });
            setProjectOptions(projects.map((project: { id: number; name: string }) => ({
                value: project.id,
                label: project.name,
            })));
        } catch (_error: unknown) {
            setProjectOptions([]);
        }
    };

    return (
        <div className='cvat-board-page'>
            <div className='cvat-board-toolbar'>
                <Text className='cvat-board-title'>Board</Text>
                <Input.Search
                    allowClear
                    className='cvat-board-search'
                    placeholder='Search tasks'
                    value={pendingSearch}
                    onChange={(event) => {
                        setPendingSearch(event.target.value);
                        if (!event.target.value) setSearch(null);
                    }}
                    onSearch={(value: string) => setSearch(value || null)}
                />
                <Select
                    showSearch
                    allowClear
                    className='cvat-board-project-select'
                    placeholder='All projects'
                    value={projectId ?? undefined}
                    filterOption={false}
                    onFocus={() => searchProjects('')}
                    onSearch={searchProjects}
                    onChange={(value?: number) => setProjectId(value ?? null)}
                    options={projectOptions}
                />
                <Select
                    showSearch
                    allowClear
                    className='cvat-board-assignee-select'
                    placeholder='Anyone'
                    value={assignee ?? undefined}
                    filterOption={false}
                    onFocus={() => searchUsers('')}
                    onSearch={searchUsers}
                    onChange={(value?: string) => setAssignee(value ?? null)}
                    options={userOptions.map((name: string) => ({ value: name, label: name }))}
                />
                <Button
                    disabled={!username}
                    type={assignee && assignee === username ? 'primary' : 'default'}
                    onClick={() => setAssignee(assignee === username ? null : username)}
                >
                    Assigned to me
                </Button>
            </div>
            <div className='cvat-board-columns'>
                {BOARD_COLUMNS.map((column) => (
                    <BoardColumnComponent key={column.key} column={column} filters={filters} />
                ))}
            </div>
        </div>
    );
}

export default React.memo(BoardPageComponent);
