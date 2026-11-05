import { redirect } from 'next/navigation';

/** Privacy is part of the profile page now; old links land on that section. */
export default function PrivacySettingsPage() {
  redirect('/member/profile#privacy');
}
