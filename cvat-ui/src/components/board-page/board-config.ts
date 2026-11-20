// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

export interface BoardColumnConfig {
    key: string;
    title: string;
    description: string;
    // JSON logic conditions that put a job in this column
    conditions: object[];
}

export const BOARD_PAGE_SIZE = 20;

export const BOARD_COLUMNS: BoardColumnConfig[] = [
    {
        key: 'unassigned',
        title: 'Unassigned',
        description: 'Waiting for an annotator',
        conditions: [
            { '==': [{ var: 'stage' }, 'annotation'] },
            { '!': { var: 'assignee' } },
        ],
    },
    {
        key: 'annotating',
        title: 'Annotating',
        description: 'With an annotator',
        conditions: [
            { '==': [{ var: 'stage' }, 'annotation'] },
            { '!!': { var: 'assignee' } },
        ],
    },
    {
        key: 'review',
        title: 'Review',
        description: 'Waiting for or in review',
        conditions: [
            { '==': [{ var: 'stage' }, 'validation'] },
        ],
    },
    {
        key: 'accepted',
        title: 'Accepted',
        description: 'Passed review',
        conditions: [
            { '==': [{ var: 'stage' }, 'acceptance'] },
        ],
    },
];

export interface BoardFilters {
    assignee: string | null;
    search: string | null;
    projectId: number | null;
    // Bumped to reload every column after a change on the board
    version: number;
}

export function buildColumnFilter(column: BoardColumnConfig, filters: BoardFilters): string {
    const conditions = [...column.conditions];

    // Unassigned jobs have no assignee, so the assignee filter only applies to the other columns
    if (filters.assignee && column.key !== 'unassigned') {
        conditions.push({ '==': [{ var: 'assignee' }, filters.assignee] });
    }

    if (filters.projectId !== null) {
        conditions.push({ '==': [{ var: 'project_id' }, filters.projectId] });
    }

    // cvat-core does not allow combining `filter` with `search`, so the task name match is a filter condition
    if (filters.search) {
        conditions.push({ in: [filters.search, { var: 'task_name' }] });
    }

    return JSON.stringify({ and: conditions });
}
