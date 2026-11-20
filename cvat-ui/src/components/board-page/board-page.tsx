// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import './styles.scss';
import React, { useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import Button from 'antd/lib/button';
import Input from 'antd/lib/input';
import Select from 'antd/lib/select';
import Text from 'antd/lib/typography/Text';

import { CombinedState } from 'reducers';
import { getCore } from 'cvat-core-wrapper';
import DistributeJobsModal from 'components/jobs-page/distribute-jobs-modal';
import BoardColumnComponent from './board-column';
import { BOARD_COLUMNS, BoardFilters } from './board-config';

const core = getCore();

interface ProjectOption {
    value: number;
    label: string;
}

// The board keeps the last project chosen, so people do not have to pick it every time
const PROJECT_STORAGE_KEY = 'cvat.board.project';

function loadProject(): ProjectOption | null {
    try {
        const stored = JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY) ?? 'null');
        return stored && typeof stored.value === 'number' && typeof stored.label === 'string' ? stored : null;
    } catch (_error: unknown) {
        return null;
    }
}

function saveProject(project: ProjectOption | null): void {
    try {
        if (project) {
            localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
        } else {
            localStorage.removeItem(PROJECT_STORAGE_KEY);
        }
    } catch (_error: unknown) {
        // Storage can be unavailable, for example in a private window
    }
}

function BoardPageComponent(): JSX.Element {
    const username = useSelector((state: CombinedState) => state.auth.user?.username ?? null);
    const [assignee, setAssignee] = useState<string | null>(null);
    const [search, setSearch] = useState<string | null>(null);
    const [pendingSearch, setPendingSearch] = useState('');
    const [userOptions, setUserOptions] = useState<string[]>([]);
    const [project, setProject] = useState<ProjectOption | null>(loadProject);
    const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
    const [version, setVersion] = useState(0);
    const projectId = project ? project.value : null;

    const filters = useMemo<BoardFilters>(
        () => ({
            assignee, search, projectId, version,
        }),
        [assignee, search, projectId, version],
    );

    const reload = useCallback((): void => setVersion((previous) => previous + 1), []);

    const chooseProject = (value?: number): void => {
        const chosen = [...projectOptions, ...(project ? [project] : [])]
            .find((option) => option.value === value) ?? null;
        setProject(chosen);
        saveProject(chosen);
    };

    const shownProjectOptions = project && !projectOptions.some((option) => option.value === project.value) ?
        [project, ...projectOptions] : projectOptions;

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
            setProjectOptions(projects.map((found: { id: number; name: string }) => ({
                value: found.id,
                label: found.name,
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
                    onChange={chooseProject}
                    options={shownProjectOptions}
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
                    <BoardColumnComponent
                        key={column.key}
                        column={column}
                        filters={filters}
                        onChanged={reload}
                    />
                ))}
            </div>
            <DistributeJobsModal onDone={reload} />
        </div>
    );
}

export default React.memo(BoardPageComponent);
