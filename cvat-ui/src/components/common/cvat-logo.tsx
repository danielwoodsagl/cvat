// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React from 'react';
import { BRAND } from '../../branding/theme';

interface Props {
    // 'light' is the white logo for dark backgrounds, 'dark' is for light backgrounds
    variant?: 'light' | 'dark';
}

function CVATLogo({ variant = 'dark' }: Readonly<Props>): JSX.Element {
    const src = variant === 'light' ? '/assets/fleetscout-logo-white.png' : '/assets/fleetscout-logo-dark.png';

    return (
        <div className='cvat-logo-icon'>
            <img src={src} alt={`${BRAND.name} logo`} />
        </div>
    );
}

export default React.memo(CVATLogo);
