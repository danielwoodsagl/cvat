// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import Button from 'antd/lib/button';
import notification from 'antd/lib/notification';
import { StopOutlined } from '@ant-design/icons';

import CVATTooltip from 'components/common/cvat-tooltip';
import { CombinedState } from 'reducers';
import { changeFrameAsync, createAnnotationsAsync } from 'actions/annotation-actions';
import { Label, ObjectType, getCore } from 'cvat-core-wrapper';

const core = getCore();

// Marks the current frame as having nothing to label, like Roboflow's null tool, then moves on.
// It uses the job's label called "null" (any letter case), which must be a tag or "any" label.
function NullFrameButton(): JSX.Element | null {
    const dispatch = useDispatch();
    const labels = useSelector((state: CombinedState) => state.annotation.job.labels);
    const frameNumbers = useSelector((state: CombinedState) => state.annotation.job.frameNumbers);
    const frame = useSelector((state: CombinedState) => state.annotation.player.frame.number);
    const objects = useSelector((state: CombinedState) => state.annotation.annotations.states);

    const nullLabel = labels.find((label: Label) => (
        label.name.trim().toLowerCase() === 'null' && ['any', ObjectType.TAG].includes(label.type)
    ));

    const onClick = useCallback(async () => {
        if (!nullLabel) return;

        const others = objects.filter((object: any) => (
            object.objectType !== ObjectType.TAG || object.label.id !== nullLabel.id
        ));
        if (others.length) {
            notification.warning({
                message: 'This frame already has annotations',
                description: 'Remove them before marking the frame as null.',
                className: 'cvat-notification-null-frame-has-annotations',
            });
            return;
        }

        const alreadyNull = objects.length > 0;
        if (!alreadyNull) {
            const tag = new core.classes.ObjectState({ objectType: ObjectType.TAG, label: nullLabel, frame });
            await dispatch(createAnnotationsAsync([tag]));
        }

        const next = [...frameNumbers].sort((a, b) => a - b).find((number) => number > frame);
        if (next === undefined) {
            notification.info({
                message: 'That was the last frame in this job',
                className: 'cvat-notification-null-frame-last',
            });
            return;
        }
        dispatch(changeFrameAsync(next));
    }, [nullLabel, objects, frame, frameNumbers]);

    const tooltip = nullLabel ?
        'Mark this frame as null (nothing to label) and go to the next frame' :
        'Add a label called "null" (tag or any type) to this project to use this';

    return (
        <CVATTooltip overlay={tooltip}>
            <Button
                type='link'
                className='cvat-annotation-header-null-button cvat-annotation-header-button'
                disabled={!nullLabel}
                onClick={onClick}
            >
                <StopOutlined />
                Null
            </Button>
        </CVATTooltip>
    );
}

export default React.memo(NullFrameButton);
