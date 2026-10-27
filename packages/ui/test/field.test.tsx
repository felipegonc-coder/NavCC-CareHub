import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  Checkbox,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '../src';

describe('Field', () => {
  it('labels and describes its control', () => {
    render(
      <Field
        label="Email"
        hint="We only use it to sign in."
        error="Enter an email address."
        required
      >
        <Input type="email" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAccessibleDescription('We only use it to sign in. Enter an email address.');
    expect(input).toBeInvalid();
    expect(input).toBeRequired();
  });

  it('chooses a select option with the keyboard', async () => {
    const user = userEvent.setup();
    render(
      <Field label="Team">
        <Select>
          <SelectTrigger>
            <SelectValue placeholder="Choose a team" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="support">Support</SelectItem>
            <SelectItem value="billing">Billing</SelectItem>
          </SelectContent>
        </Select>
      </Field>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Team' });
    expect(trigger).toHaveTextContent('Choose a team');

    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    // With nothing chosen yet, the first option gets focus.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Support' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Billing' })).toHaveFocus());
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(trigger).toHaveTextContent('Billing');
  });

  it('toggles a checkbox with Space and a switch with a click', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Field label="Email me a copy" layout="inline">
          <Checkbox />
        </Field>
        <Field label="Notifications" layout="inline">
          <Switch />
        </Field>
      </>,
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Email me a copy' });
    checkbox.focus();
    await user.keyboard(' ');
    expect(checkbox).toBeChecked();

    const toggle = screen.getByRole('switch', { name: 'Notifications' });
    await user.click(toggle);
    expect(toggle).toBeChecked();
  });
});
