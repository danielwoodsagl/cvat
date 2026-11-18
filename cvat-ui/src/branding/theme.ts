// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

// FleetScout branding. Everything that makes this build look like FleetScout rather than
// stock CVAT lives in this folder, so the fork stays easy to rebase onto new CVAT releases.

import { ThemeConfig } from 'antd/lib/config-provider';

export const BRAND = {
    name: 'FleetScout',
    productTitle: 'FleetScout Annotation',
    tagline: 'Fully-Automated Fleet Damage Management.',
    // Hide CVAT's own promotion (GitHub button, star prompt) in this build
    hideCvatPromotion: true,
};

export const BRAND_COLORS = {
    green: '#009D4F',
    blue: '#234E9C',
    navy: '#0E1339',
    grey: '#364042',
};

const BODY_FONT = 'Montserrat, Lato, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export const fleetscoutTheme: ThemeConfig = {
    token: {
        // Blue rather than green for primary actions: white text on FleetScout green is
        // below WCAG AA contrast for normal-sized text, white on the blue is well above it.
        colorPrimary: BRAND_COLORS.blue,
        colorLink: BRAND_COLORS.blue,
        colorSuccess: BRAND_COLORS.green,
        colorInfo: BRAND_COLORS.blue,
        fontFamily: BODY_FONT,
    },
};
