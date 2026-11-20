// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, {
    useCallback, useEffect, useRef, useState,
} from 'react';
import Button from 'antd/lib/button';
import Spin from 'antd/lib/spin';
import Text from 'antd/lib/typography/Text';
import notification from 'antd/lib/notification';

import { Job, getCore } from 'cvat-core-wrapper';
import { JobPeople, getJobPeople } from 'components/job-workflow/api';
import BoardCardComponent from './board-card';
import {
    BOARD_PAGE_SIZE, BoardColumnConfig, BoardFilters, buildColumnFilter,
} from './board-config';

const core = getCore();

interface Props {
    column: BoardColumnConfig;
    filters: BoardFilters;
    onChanged: () => void;
}

function BoardColumnComponent({ column, filters, onChanged }: Readonly<Props>): JSX.Element {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [people, setPeople] = useState<Record<number, JobPeople>>({});
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const [fetching, setFetching] = useState(false);
    // Ignore responses that belong to a previous set of filters
    const requestId = useRef(0);

    const fetchPage = useCallback(async (nextPage: number): Promise<void> => {
        requestId.current += 1;
        const { current } = requestId;
        setFetching(true);

        try {
            const query = {
                page: nextPage,
                pageSize: BOARD_PAGE_SIZE,
                sort: '-updated_date',
                filter: buildColumnFilter(column, filters),
            };
            const result = await core.jobs.get(query);

            if (current !== requestId.current) return;

            const { count: total } = result;
            setCount(total);
            setJobs((previous) => (nextPage === 1 ? [...result] : [...previous, ...result]));
            setPage(nextPage);

            // The annotator and reviewer are extra; the cards still work without them
            getJobPeople(result.map((job: Job) => job.id)).then((found) => {
                if (current !== requestId.current) return;
                setPeople((previous) => (nextPage === 1 ? found : { ...previous, ...found }));
            }).catch(() => null);
        } catch (error: unknown) {
            if (current !== requestId.current) return;

            notification.error({
                message: `Could not load the ${column.title} column`,
                description: error instanceof Error ? error.message : String(error),
                className: 'cvat-notification-notice-board-load-error',
            });
        } finally {
            if (current === requestId.current) setFetching(false);
        }
    }, [column, filters]);

    useEffect(() => {
        fetchPage(1);
    }, [fetchPage]);

    return (
        <div className={`cvat-board-column cvat-board-column-${column.key}`}>
            <div className='cvat-board-column-header'>
                <Text strong>{column.title}</Text>
                <span className='cvat-board-column-count'>{count}</span>
            </div>
            <Text type='secondary' className='cvat-board-column-description'>{column.description}</Text>
            <div className='cvat-board-column-cards'>
                {jobs.map((job: Job) => (
                    <BoardCardComponent
                        key={job.id}
                        job={job}
                        people={people[job.id] ?? null}
                        onChanged={onChanged}
                    />
                ))}
                {fetching && <Spin className='cvat-board-column-spinner' />}
                {!fetching && jobs.length === 0 && (
                    <Text type='secondary' className='cvat-board-column-empty'>Nothing here</Text>
                )}
                {!fetching && jobs.length < count && (
                    <Button block onClick={() => fetchPage(page + 1)}>
                        {`Show more (${count - jobs.length} left)`}
                    </Button>
                )}
            </div>
        </div>
    );
}

export default React.memo(BoardColumnComponent);
