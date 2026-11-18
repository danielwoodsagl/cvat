// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

// Calls for the job workflow actions (split between people, return flagged frames).
// They go through cvat-core so the organisation context and CSRF handling are applied.

import { getCore } from 'cvat-core-wrapper';

const core = getCore();

export interface WorkflowJob {
    id: number;
    task_id: number;
    assignee: { id: number; username: string } | null;
    frame_count?: number;
}

function url(path: string): string {
    return `${core.config.backendAPI}${path}`;
}

export async function splitJobBetween(jobId: number, assigneeIds: number[]): Promise<WorkflowJob[]> {
    const response = await core.server.request(url(`/jobs/${jobId}/split`), {
        method: 'POST',
        data: { assignees: assigneeIds },
    }) as { data: WorkflowJob[] };
    return response.data;
}

export async function returnFlaggedFrames(jobId: number, assigneeId: number | null): Promise<WorkflowJob> {
    const response = await core.server.request(url(`/jobs/${jobId}/return_flagged_frames`), {
        method: 'POST',
        data: assigneeId === null ? {} : { assignee: assigneeId },
    }) as { data: WorkflowJob };
    return response.data;
}

export interface UserOption {
    id: number;
    username: string;
}

export async function searchUsers(search: string): Promise<UserOption[]> {
    const users = await core.users.get({ limit: 20, is_active: true, ...(search ? { search } : {}) });
    return users.map((user: { id: number; username: string }) => ({ id: user.id, username: user.username }));
}
