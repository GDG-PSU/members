import { redirect } from 'next/navigation';

/** Invitations are sent from the People page now; old links land on its form. */
export default function InvitationsPage() {
  redirect('/admin/users?invite=1');
}
