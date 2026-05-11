'use client';

import * as Select from '@radix-ui/react-select';

type SelectOption<T extends string> = {
  value: T;
  label: string;
};

export function SelectField<T extends string>({
  label,
  value,
  onValueChange,
  options,
  required = true,
  disabled = false,
}: {
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: Array<SelectOption<T>>;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <Select.Root
        value={value}
        onValueChange={(next) => onValueChange(next as T)}
        required={required}
        disabled={disabled}
      >
        <Select.Trigger className="select-trigger" aria-label={label}>
          <Select.Value />
          <Select.Icon className="select-icon">⌄</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-content" position="popper">
            <Select.Viewport>
              {options.map((option) => (
                <Select.Item key={option.value} value={option.value} className="select-item">
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="select-indicator">✓</Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </label>
  );
}
