'use client';

import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { addManualContact } from '@/actions/contacts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  listId: string;
}

export function AddContactDialog({ listId }: Props) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [consentBasis, setConsentBasis] = useState<'consent' | 'legitimate_interest' | 'existing_customer'>('consent');
  const [consentEvidence, setConsentEvidence] = useState('');
  const [phoneError, setPhoneError] = useState('');

  function resetForm() {
    setPhone('');
    setFirstName('');
    setLastName('');
    setEmail('');
    setConsentBasis('consent');
    setConsentEvidence('');
    setPhoneError('');
  }

  function handleOpenChange(value: boolean) {
    if (!value) resetForm();
    setOpen(value);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhoneError('');

    startTransition(async () => {
      const result = await addManualContact({
        listId,
        phone,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        email: email || undefined,
        consentBasis,
        consentEvidence: consentEvidence || undefined,
      });

      if (!result.ok) {
        if (result.message === 'phone_invalid') {
          setPhoneError(t('add_contact_phone_invalid'));
        } else {
          toast.error(result.message);
        }
        return;
      }

      if (result.inserted === false) {
        toast.warning(t('add_contact_already_exists'));
      } else {
        toast.success(t('add_contact_success'));
      }

      setOpen(false);
      resetForm();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus className="mr-1 size-4" />
          {t('add_contact_btn')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('add_contact_dialog_title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="add-phone">{t('phone')} *</Label>
            <Input
              id="add-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t('add_contact_phone_placeholder')}
              required
            />
            {phoneError && (
              <p className="text-xs text-destructive">{phoneError}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="add-first-name">{t('first_name')}</Label>
              <Input
                id="add-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-last-name">{t('last_name')}</Label>
              <Input
                id="add-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={200}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="add-email">{t('email')}</Label>
            <Input
              id="add-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="add-consent-basis">{t('consent_basis_label')}</Label>
            <Select value={consentBasis} onValueChange={(v) => setConsentBasis(v as typeof consentBasis)}>
              <SelectTrigger id="add-consent-basis">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="consent">{t('consent_basis_consent')}</SelectItem>
                <SelectItem value="legitimate_interest">{t('consent_basis_legitimate_interest')}</SelectItem>
                <SelectItem value="existing_customer">{t('consent_basis_existing_customer')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="add-consent-evidence">{t('consent_evidence_label')}</Label>
            <Input
              id="add-consent-evidence"
              value={consentEvidence}
              onChange={(e) => setConsentEvidence(e.target.value)}
              placeholder={t('consent_evidence_placeholder')}
              maxLength={500}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('back')}
            </Button>
            <Button type="submit" disabled={isPending || !phone}>
              {isPending ? t('add_contact_submitting') : t('add_contact_btn')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
