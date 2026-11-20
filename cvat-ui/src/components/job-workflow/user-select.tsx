// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useEffect, useState } from 'react';
import Select from 'antd/lib/select';

import { UserOption, displayName, searchUsers } from './api';

interface Props {
    value: UserOption | null;
    placeholder: string;
    className?: string;
    disabled?: boolean;
    onChange: (user: UserOption | null) => void;
}

// Picks an active user by name. The current value stays in the list even when a search leaves it out.
function UserSelect({
    value, placeholder, className, disabled, onChange,
}: Readonly<Props>): JSX.Element {
    const [options, setOptions] = useState<UserOption[]>([]);

    const search = (text: string): void => {
        searchUsers(text).then(setOptions).catch(() => setOptions([]));
    };

    useEffect(() => search(''), []);

    const all = value && !options.some((user) => user.id === value.id) ? [value, ...options] : options;

    return (
        <Select
            showSearch
            allowClear
            className={className}
            style={{ width: '100%' }}
            placeholder={placeholder}
            disabled={disabled}
            filterOption={false}
            onSearch={search}
            value={value?.id}
            onChange={(id?: number) => onChange(all.find((user) => user.id === id) ?? null)}
            options={all.map((user) => ({ value: user.id, label: displayName(user) }))}
        />
    );
}

export default React.memo(UserSelect);
