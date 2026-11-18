// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import Alert from 'antd/lib/alert';
import Button from 'antd/lib/button';
import Divider from 'antd/lib/divider';

interface SSOProvider {
    id: string;
    name: string;
    login_url: string;
}

const SSO_ERRORS: Record<string, string> = {
    domain: 'Microsoft sign-in is only for FleetScout accounts. If you have a CVAT username and password, use those below.',
    inactive: 'This account has been switched off. Ask an administrator to turn it back on.',
    failed: 'Microsoft sign-in did not finish. Please try again.',
};

function readCookie(name: string): string {
    const match = document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

// Starting an SSO sign-in must be a POST with the CSRF token, so submit a small form
function startSignIn(provider: SSOProvider, next: string): void {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = provider.login_url;
    const fields: Record<string, string> = {
        csrfmiddlewaretoken: readCookie('csrftoken'),
        process: 'login',
        next,
    };
    Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
}

function SSOSignInComponent(): JSX.Element | null {
    const location = useLocation();
    const [providers, setProviders] = useState<SSOProvider[]>([]);
    const params = new URLSearchParams(location.search);
    const error = SSO_ERRORS[params.get('sso_error') ?? ''];
    const requested = params.get('next') ?? '/';
    // Only same-site paths, so the sign-in cannot be used to send people elsewhere
    const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

    useEffect(() => {
        let cancelled = false;
        fetch('/api/auth/sso', { credentials: 'same-origin' })
            .then((response) => (response.ok ? response.json() : []))
            .then((data: SSOProvider[]) => {
                if (!cancelled && Array.isArray(data)) setProviders(data);
            })
            .catch(() => {
                if (!cancelled) setProviders([]);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (!providers.length && !error) {
        return null;
    }

    return (
        <div className='cvat-sso-sign-in'>
            {error && <Alert className='cvat-sso-error' type='warning' showIcon message={error} />}
            {providers.map((provider) => (
                <Button
                    key={provider.id}
                    type='primary'
                    size='large'
                    block
                    className={`cvat-sso-button cvat-sso-button-${provider.id}`}
                    onClick={() => startSignIn(provider, next)}
                >
                    {`Sign in with ${provider.name}`}
                </Button>
            ))}
            {providers.length > 0 && (
                <Divider plain className='cvat-sso-divider'>or use your CVAT username</Divider>
            )}
        </div>
    );
}

export default React.memo(SSOSignInComponent);
