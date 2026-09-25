import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from './Button';
import { Field } from './Field';
import { Textarea } from './Input';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  /** Sensitive actions require a reason that is stored in the audit log (spec §54). */
  requireReason?: boolean;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = 'danger',
  requireReason,
  loading,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);
  const reasonMissing = requireReason && reason.trim().length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={body}
      size="sm"
      busy={loading}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={loading}
            onClick={() => {
              setTouched(true);
              if (!reasonMissing) onConfirm(reason.trim());
            }}
          >
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      {(requireReason || children) && (
        <div className="space-y-4">
          {children}
          {requireReason && (
            <Field label={t('common.reason')} hint={t('common.reason_hint')} error={touched && reasonMissing ? 'validation.required' : undefined}>
              <Textarea data-autofocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}
