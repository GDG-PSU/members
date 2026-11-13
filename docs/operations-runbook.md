# Operations runbook

For GDG@PSU organizers. Support address: **gdg@psu.edu**.

Two rules sit above everything here. Never give attendance or points "to fix it
later" without a reason on the record. Never edit points history; corrections
are new entries.

## Before an event

1. **Event:** create it (it starts as a draft), check its times, points and
   attendance rules, then publish it. Add a bonus session only if part of the
   event needs its own check-in and points.
2. **Reader:** connect it at `/admin/cards` and open **Reader tools**. It should
   say the NFC module is ready and that Bluetooth is ready.
3. **Sign-in:** sign in with your password and authenticator app on the laptop
   or tablet that will run the kiosk, and check that member photos load.
4. **Test card:** write and read one spare card, never a member's.
5. **If the site is down:** keep a paper list. Cards are never read "offline"
   and entered later as checked attendance.

## Running the kiosk

1. Open the event and select **Open kiosk**, or open `/admin/kiosk` and choose
   the session. Select **Connect reader** once; on later visits the browser
   reconnects by itself.
2. There is no read button. The member taps their card and the page shows their
   name, photo, and whether this is a check-in or a check-out. **Nothing is
   recorded yet.** A card must be lifted before the next one is read.
3. Compare the person to the photo. If the page says **Photo changed in the last
   48 hours**, ask for their PSU ID and tick **I checked this member's PSU ID**.
   Then confirm.
4. On the way out the member taps again and you confirm the check-out. Points
   and stars are added when it falls inside the event's check-out time.
5. A member who leaves without checking out earns nothing. Do not confirm a
   check-out they did not make.
6. Bonus sessions are checked in and out separately.
7. **No card:** under **No card?**, type the member's name or GDG number, or
   select **Scan QR code** and scan the code on their **Digital ID**. The same
   photo check and confirmation follow.

## Writing or replacing a card

1. Open `/admin/cards` and connect the reader. From a person's page, **Write a
   card for them** opens it with that person chosen.
2. Find the person by name or GDG number. Members and organizers can both have
   a card.
3. Select **Write card** and place a blank NTAG213, NTAG215 or NTAG216 card on
   the reader. The page prepares
   the card, writes it, reads it back and switches it on, and reports success
   only if what it read back is what it wrote. If anything fails, the person's
   old card keeps working.
4. Lift the card before writing the next one. The person's previous card stops
   working once the new one is on.
5. Never write a card for someone whose identity you have not checked.

**Reader tools**, at the bottom of the page, reads any card, writes a link you
type by hand (for testing a reader or restoring a card; it makes nobody a
card), and shows the reader's messages.

## The reader

A reader works only for a signed-in organizer. It is given a key of its own when
it is flashed, the site holds the same key, and nothing else can drive it, by
cable or by Bluetooth.

**By cable:** plug it into the computer and select **Connect reader**.

**By Bluetooth,** when there is no data cable or the reader sits away from the
computer:

1. Power the reader from a charger or power bank. After about three seconds its
   light blinks slowly.
2. Select **Use Bluetooth**, pick the reader in the browser's list (for example
   `GDG Reader 2DF4`), and wait for **Bluetooth** to appear beside its status.
3. After reloading the page, select **Use Bluetooth** again; the browser asks
   each time a page is opened.

**The cable always wins.** Plug the reader into the computer and the page moves
to USB by itself. **Switch to Bluetooth** uses Bluetooth with the cable in, and
**Switch to USB** goes back. Move the cable to a charger and the page returns to
Bluetooth.

| The reader's light                        | Meaning                                     |
| ----------------------------------------- | ------------------------------------------- |
| Off                                       | The NFC module is not answering             |
| Two quick flashes every two seconds       | It has no key. Plug it in at `/admin/cards` |
| Steady                                    | Ready, with a computer on its cable         |
| Slow blink                                | Waiting for a Bluetooth connection          |
| Steady with a short dip every two seconds | In use over Bluetooth                       |

In **Reader tools**, with the reader connected:

- **Rotate key** gives the reader a new key. It keeps working for every
  organizer, and anything that held the old key stops. Use it when a reader
  comes back after being out of your hands.
- **Switch Bluetooth off on this reader** (cable only) keeps it off the air
  until it is switched on again the same way.

### When the reader will not work

| What you see                                | What to do                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Not in the Bluetooth list                   | Check it has power and the light blinks slowly. Steady means a computer is on its cable                                       |
| Two quick flashes                           | It has no key. Plug it in at `/admin/cards`; the page gives it one                                                            |
| "did not accept this site"                  | It holds a key from somewhere else. Ask a developer to erase and flash it                                                     |
| "This site does not hold this reader's key" | The same, or the site's record was cleared. Ask a developer to erase and flash it                                             |
| Nothing happens on **Connect reader**       | Close other tabs using the reader, then reconnect. Use Chrome or Edge                                                         |
| An older reader works by cable only         | Its firmware is older than 2.2.0. Ask a developer to flash it                                                                 |
| "This card type is not supported"           | Use an NTAG213, NTAG215 or NTAG216 card. A reader on firmware before 2.2.1 refuses NTAG216 cards: ask a developer to flash it |

Chrome and Edge on a computer can use the cable and Bluetooth. Chrome on Android
can use Bluetooth only. Safari and Firefox cannot use a reader.

## A lost, stolen or replaced card

1. Switch the card off: **Switch off** in the list at `/admin/cards`, or on the
   person's page. Its link stops working at once; their profile address does
   not change.
2. Write a replacement as above.
3. Until then, the member's **Digital ID** works at the kiosk.

## A lost reader

Nobody can use it without signing in as an organizer, and it shares its key with
no other reader. If it comes back, use **Rotate key** before trusting it. If it
does not, nothing else needs changing.

## Deleting for good (superadmins)

Organizers hide things: an event is cancelled, a reward or a card switched off,
a member archived. A superadmin can also delete with **Delete for good**. Every
delete asks first, names what will go, and cannot be undone.

| What           | Where                           | What goes with it                                                           |
| -------------- | ------------------------------- | --------------------------------------------------------------------------- |
| Event          | The event's page                | Its sessions and attendance. Members keep the points it gave                |
| Reward         | The reward's edit page          | Its handled requests. Refused while a request is waiting                    |
| Reward request | **Recently handled** on Rewards | Only the request. Points are not changed                                    |
| Card           | **Cards issued** on Cards       | The card stops working and its record goes                                  |
| Attendance     | The member's page               | One record that gave no points. Disqualify it first if it did               |
| Invitation     | Its row on People               | The unused account made for it                                              |
| Account        | The person's manage page        | Their sign-in, profile, photo, card, attendance, points and reward requests |

The audit log records each delete, by name for an event or a reward and without
a name for a person. Nobody can change or delete the audit log.

## Correcting attendance

Superadmins only, from the member's page, always with a reason.

- **Missed check-out:** set the check-out time, then qualify. The points are
  given once.
- **Wrongly qualified:** disqualify. A reversal is added; the original entry
  stays.
- If a member writes in, check that the message comes from their registered
  address and look at the attendance and audit history first. A screenshot is
  not proof of attendance.

## Support requests

1. The member emails **gdg@psu.edu** from their registered address. Never
   discuss an account with a different address.
2. **Password reset:** a superadmin opens the person from **People**, selects
   **Make a password reset link**, and sends the link from their own mailbox.
   Never email a password. A reset link works for 48 hours and an invitation for
   72; an invitation nobody used shows as **Not accepted**, where **New link**
   reopens it.
3. **Attendance or points:** check the records, correct with a reason if
   warranted, and reply with the outcome.
4. **Closing an account:** confirm who is asking and explain what is removed
   (`PRIVACY.md`). A superadmin then uses **Delete for good** on the person's
   manage page, which also removes their photos.

## Incidents

| Incident                                       | What to do                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| An organizer's account is used by someone else | A superadmin removes their access on People. Reset their authenticator in Supabase Auth and review the audit log |
| A lost authenticator                           | Reset the factor in Supabase Auth. The organizer signs in with their password and sets up a new one              |
| A wrong points grant                           | Never delete it. A superadmin corrects the attendance, which adds a reversal                                     |
| A list of card links leaks                     | Switch those cards off and write replacements. Profile addresses are unaffected                                  |
| The site is down                               | Keep a paper list. Give no points offline; enter corrections with a reason afterwards                            |
| A migration fails                              | Stop deploying and tell a developer. The fix is a new migration, never a hand edit                               |

## After an event

1. Close the kiosk tab and look over the last confirmations.
2. Review the attendance for anything odd, such as two rewards for one person.
3. A published event counts as ended once its end time passes; cancel it only if
   it did not happen.
4. Take a backup after a large event if backups are not automatic
   (`docs/backup-restore.md`).
