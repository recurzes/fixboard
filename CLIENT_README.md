# Fixboard: notes for the owner

Fixboard replaces scattered texts and emails with one place for maintenance requests. Tenants fill in a short form with no login. Staff see every request on one dashboard, assign it, schedule it, and mark it done.

**Where it stands:** the tenant form and the staff dashboard are built and tested, and run on demo data. They are not on a live website yet. Putting them online is the next step. Setup and technical details are in [README.md](README.md).

## Assumptions I made

You have already confirmed some of these. The rest are my best guess until you answer the questions below.

- **No notifications in V1** (you confirmed). Nobody gets an email or text about a new request. Staff see new requests highlighted on the dashboard with a count.
- **Tenants have no accounts** (you confirmed). They get a reference number and cannot look up a request afterwards.
- **Every request is accepted.** If the name, email or phone doesn't match your tenant list for that unit, the request still comes in, flagged for staff to check.
- **A tenant must give a phone number, an email, or both.**
- **"Above 90°F" is the tenant's own report.** The form asks, and nothing checks the weather.
- **Your state is unknown,** so the time zone is set to US Eastern. The privacy and entry-notice wording are placeholders.
- **Up to 5 photos per request,** JPG, PNG or HEIC, with no video. Photo location data is removed before saving.
- **Unit numbers show in the form's dropdown,** so anyone who opens the form can see which units exist.
- **One staff role.** Every staff member sees every property, and staff accounts are created by the developer, not from a screen.
- **Records are kept 2 years,** but nothing deletes old ones yet.
- **English only.** Staff notes are never shown to tenants.

## Questions for you

1. **Who checks the dashboard for new requests, and how often?** With no notifications, a request nobody looks at goes unseen. This matters most.
2. **What is the real emergency phone number?** The form shows `(000) 000-0000` until you give it.
3. **Do you approve the self-help tips?** The form suggests resetting an outlet or breaker, and plunging a clogged drain. I wrote them to be cautious, and they need your sign-off. Do you want one for AC/heating too? The plan included one, and none is written yet.
4. **Which state are your properties in?** That decides the time zone, the entry-notice rules and the privacy wording.
5. **Is it OK that unit numbers show in the form?** The other option is a box where tenants type their unit.
6. **How long should requests and photos be kept?** I assumed 2 years.
7. **Should a match on email or phone alone count as a match,** or should the name have to match too?

## Which parts AI wrote

I used an AI coding assistant (Claude) throughout. It wrote most of the code and tests, working from specs and a stage-by-stage plan that I wrote and directed. I made the product and design decisions, reviewed the changes, and ran the app and the tests. The AI also drafted parts of the documentation, including this file.

## Known issues

- **iPhone sign-in for staff:** Safari blocks the sign-in cookie, so staff using Safari on an iPhone can't stay signed in. The fix is to serve sign-in from the same web address as the app, and it's planned for the deploy step. Tenants are not affected, because the form has no login.
- **No notifications** (by design for V1, see question 1).
- **No AC/heating self-help tip yet** (see question 4).
- **Old records are never deleted,** and there is no setting for it yet.
- **Staff accounts and the tenant list** are set up by running a script, not from a screen.
- **Form spam limits reset when the server restarts.** They are fine for one server. They need changing if the app ever runs on more than one.
- **Minor:** when you edit a phone number in the middle, the cursor jumps to the end.

## What I'd do next

1. **Walk through a demo with you,** and settle the questions above.
2. **Notifications:** an email to staff for each new request, a text to the on-call person for urgent ones, and a confirmation email to the tenant with their reference number.
3. **An admin page,** so you can manage staff, properties, tenants and form questions without a developer.
