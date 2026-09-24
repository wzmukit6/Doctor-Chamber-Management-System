import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('requires a reason before confirming sensitive actions', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Deactivate?" requireReason onConfirm={onConfirm} onClose={() => {}} confirmLabel="Deactivate" />);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/required/i);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Left the chamber ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledWith('Left the chamber');
  });

  it('is an accessible modal dialog labelled by its title', () => {
    render(<ConfirmDialog open title="Remove user?" onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Remove user?' })).toHaveAttribute('aria-modal', 'true');
  });
});
