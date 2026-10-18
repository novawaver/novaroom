# Novaroom

Novaroom is a Windows 11 chat app for AI trainers: annotators, raters, and prompt writers. The window is a [Tauri 2](https://tauri.app) shell. The screens are React and TypeScript. Accounts, profiles, and live messages are meant to live in [Supabase](https://supabase.com).

Until you connect a Supabase project, the app runs in a local preview on this computer. Preview sign-in accepts the code `000000` and stores profiles and chats in the app’s local storage.

## What you need

Install these before the first run. Windows 11 already includes the WebView2 runtime that Tauri uses.

| Tool | Why |
|---|---|
| Node.js 20 or newer, with npm | Installs the frontend and starts Vite |
| Rust, via rustup, stable toolchain | Compiles the Tauri shell |
| Visual Studio Build Tools 2022, with the C++ workload | Provides `link.exe`, which Rust needs on Windows |
| A Supabase project | Real email codes, shared profiles, and live messages. Optional for preview |

Check what is already installed:

```powershell
node -v
npm -v
rustc --version
```

If `rustc` is not recognized, install Rust and then open a new terminal so the path picks up `%USERPROFILE%\.cargo\bin`.

```powershell
winget install --id Rustlang.Rustup -e
rustup default stable
```

If a Rust compile stops with `linker link.exe not found`, install the C++ build tools. This download is large.

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --quiet --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

## Run the app

From this folder:

```powershell
cd D:\A-Projects\novaroom-app
npm install
npm run tauri dev
```

The first compile downloads Rust crates and can take several minutes. Later launches are much faster. Vite serves the screens at `http://127.0.0.1:1420`, and Tauri opens the Novaroom window.

Closing the window leaves Novaroom running in the system tray. Left-click the tray icon, or choose **Show Novaroom**, to open it again. **Quit** on that menu closes the app. New messages can show a Windows toast and a count on the taskbar icon. Appearance (system, light, or dark) is in Profile.

To work on the screens in a browser only:

```powershell
npm run dev
```

Then open `http://127.0.0.1:1420`. That browser preview does not build the Windows shell.

Stop the app with Ctrl+C in the terminal that started it. If port 1420 is already taken, close the other Novaroom or Vite process and start again.

## Local preview

Leave `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` unset. The sign-in screen says you are in local preview.

1. Enter any email address and choose **Send code**.
2. Enter `000000`.
3. Open **Profile** from the chip at the bottom of the sidebar. Set your name, photo, status, and tags, then save.
4. Choose **New chat**, type another email, and choose **Start chat**. **New group** asks for a group name and the members’ emails. In preview, those people do not need an account yet.
5. Write a message and choose **Send**. Enter searches the open chat. Shift+Enter adds a line.
6. Sign out. Sign in as the other email with `000000`. The same conversation is there, with the message history.

Preview data stays in this Windows user account’s app storage. It is not shared with other computers. A wrong code shows an error and does not sign you in.

Do not put real client work in the chat. The composer reminds you that trainers are usually under an NDA.

## Connect Supabase

Create a free project at [supabase.com/dashboard](https://supabase.com/dashboard). Wait until the database is ready.

### 1. Run the database scripts

Open **SQL Editor** and run the files in this order. Paste the whole file, then run it. Do not skip the first one.

1. `supabase/migrations/20261006120000_profiles.sql` creates profiles, profile security rules, an avatar bucket, and a trigger that creates a profile when someone signs up.
2. `supabase/migrations/20261006130000_messages.sql` creates one-to-one chats, message security rules, and turns on live message delivery.
3. `supabase/migrations/20261006140000_groups_and_files.sql` adds group chats of up to 50 people and a private bucket for images and files up to 25 MB.
4. `supabase/migrations/20261006150000_safety.sql` adds block, report, delete message, and delete account.
5. `supabase/migrations/20261006160000_rooms.sql` adds the Coding, Writing, Math, and Rating rooms.

If the second script reports that `public.messages` is already in the realtime publication, the messages table is already live and you can continue. If you already ran the earlier scripts, run only the ones you have not run yet. Run the rooms script before testers join a topic room.

These rules let a signed-in person read profiles, see only chats they belong to, and send messages only as themselves. A block stops direct messages in both directions and hides the blocked person's messages from the person who blocked them. Reports are visible to the reporter and to you in the Supabase dashboard, not to other trainers. Have someone read `20261006150000_safety.sql` before a public launch. The app does not use end-to-end encryption.

### 2. Turn on email codes

In the dashboard, open **Authentication → Sign In / Providers** and leave **Email** enabled.

Open **Authentication → Emails → Templates** and edit the **Magic Link** template. The message must include this token or the app cannot ask for a 6-digit code:

```text
{{ .Token }}
```

You can keep the magic link in that same email. Novaroom uses the code.

### 3. Add the project keys

In **Project Settings → API Keys**, copy the project URL and the **publishable** key. That key starts with `sb_publishable_`. The older dashboard calls the same public key the anon key, and that one is a long value starting with `eyJ`.

Do not put a secret key in this file. A secret key starts with `sb_secret_`, or the older dashboard calls it the service role key. The app sends this value to every person who installs Novaroom. A secret key bypasses the database rules and would let anyone read and change other people’s chats.

In this folder, copy the example file and fill it in:

```powershell
copy .env.example .env
```

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

`.env` is ignored by git. Do not commit it.

Stop the app and start it again with `npm run tauri dev`. Vite only reads `.env` when it starts.

The preview notice disappears once both values are set. **Send code** then emails a real code. The other person must sign in once before you can start a chat with their email. If they have no account yet, the app says no Novaroom account uses that email.

Profile photos upload to the `avatars` bucket created by the first script.

### 4. Confirm a real chat

Use two email addresses you can open.

1. Sign in on this computer with the first email and the code from that inbox.
2. Save a profile name.
3. On another computer, or after signing out, sign in with the second email.
4. From the first account, start a chat with the second email and send a message.
5. The second account should see the message without refreshing. That is the live subscription on `public.messages`.

Search still filters messages already loaded in the open chat.

## Safety

From a direct chat, **Block** hides that person's messages and stops either of you from sending in the direct chat. **Unblock** is on that chat and under Profile. In a group, **Block** is on that person's message. Their group messages disappear for you, and you still cannot direct-message them.

**Report** is on someone else's message. Choose harassment, spam, confidential client information, or something else. You can add a short note. Each person can report a message once. The report keeps a copy of the text. To review reports, open the Supabase **Table Editor**, table `reports`. That view uses the project owner account. Other trainers cannot read reports they did not file.

**Delete** on your own message clears the text and any file. Everyone in the chat then sees "Message deleted."

**Delete account** is at the bottom of Profile. It removes the login, profile photo, and the contents of your messages. Reports already filed stay so a leak can still be reviewed, without the deleted login attached.

In local preview, the same actions work on this computer. Preview reports stay in app storage. They are not sent to Supabase.

## Topic rooms

Coding, Writing, Math, and Rating are open rooms. A signed-in trainer chooses **Join** and can talk with everyone else in that room. They do not need each other's email addresses.

**Leave** drops you from the room. You can join again later.

For a private beta, ask 10 to 20 trainers to install Novaroom, sign in with the email code, and join the room that matches their work. Direct chats and groups are still there for people who already know each other.

## Publish an update on GitHub

The code lives at [github.com/novawaver/novaroom](https://github.com/novawaver/novaroom). Pushing a commit to `main` only saves the code. Installed copies of Novaroom update only when you push a version tag such as `v0.2.0`. The tag starts `.github/workflows/release.yml`, which builds the installer on GitHub and publishes it as a release. Installed apps check that release and offer the update.

### One-time setup

In the repository, open **Settings → Secrets and variables → Actions** and add these four repository secrets. The release stops at its first step if one is missing.

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The full text inside the private key file from `npx tauri signer generate`, not the file path |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you chose for that key |
| `VITE_SUPABASE_URL` | The same value as in your `.env` |
| `VITE_SUPABASE_ANON_KEY` | The same value as in your `.env` |

Keep the private key file somewhere safe and out of this folder. If it is lost, installed apps cannot accept updates signed with a new key. The repository must stay public, because installed apps read releases without signing in.

### Each release

1. Choose the new version number. Use a higher number than the last release, for example `0.1.0` to `0.2.0`, or `0.1.1` for a small fix.

2. Change the version in all three of these files. They must match, or the updater can offer the wrong version.

   | File | Line |
   |---|---|
   | `package.json` | `"version": "0.2.0",` |
   | `src-tauri/tauri.conf.json` | `"version": "0.2.0",` |
   | `src-tauri/Cargo.toml` | `version = "0.2.0"` |

3. Check that the app still builds. This also updates `src-tauri/Cargo.lock` with the new version.

   ```powershell
   npm run build
   cd src-tauri
   cargo check
   cd ..
   ```

4. If you added a file under `supabase/migrations/`, run it in the Supabase **SQL Editor** before you publish. The new app may need it as soon as people update.

5. Look at what will be committed. `.env` and `src-tauri/target/` must not appear in the list.

   ```powershell
   git status
   ```

6. Commit and push the code to `main`.

   ```powershell
   git add -A
   git commit -m "Release v0.2.0"
   git push origin main
   ```

7. Tag the commit and push the tag. This starts the release build.

   ```powershell
   git tag v0.2.0
   git push origin v0.2.0
   ```

8. Open the **Actions** tab on GitHub and watch the **Release** run. It takes about 10 to 20 minutes. When it is green, the **Releases** page shows `Novaroom v0.2.0` with the setup file, `latest.json`, and signature files.

9. Open an installed older copy of Novaroom. It should show a banner saying **Novaroom 0.2.0 is available**. Install the update and check that the banner does not come back.

### If the release fails

Open the failed run on the **Actions** tab and read the first red step.

- **These repository secrets are missing or empty.** Add the named secrets, then run the tag again (below).
- **TAURI_SIGNING_PRIVATE_KEY must be the full contents.** Paste the text inside the key file, not its path.
- **A build error.** Fix it, commit, and push to `main`. Then move the tag to the fixed commit.

To run the same tag again after a fix, delete it on both sides and push it again. Also delete the half-made release on the **Releases** page if one appeared.

```powershell
git tag -d v0.2.0
git push origin --delete v0.2.0
git tag v0.2.0
git push origin v0.2.0
```

Do not reuse a version number that already reached users. If a published release is broken, publish the next number, for example `v0.2.1`.

## Microsoft Store

Version 0.1.0 is prepared as a Windows installer. It is not published yet. The listing needs your Partner Center account, a public privacy-policy address, and a name reservation.

The privacy policy and terms are in the app under **Profile → About**. Novaroom is set to **18 and older**. Messages are not end-to-end encrypted, and the policy says so. Have someone read `supabase/migrations/` before a public listing. That read has not been done from this project.

Before you submit:

1. Run a USPTO trademark search for “Novaroom” and reserve the name in [Partner Center](https://partner.microsoft.com/dashboard). This project cannot do that search for you.
2. Publish the Profile privacy policy at a public URL. Partner Center requires that address.
3. Build the installer from this folder:

```powershell
$env:CARGO_TARGET_DIR = "D:\A-Projects\novaroom-app\src-tauri\target"
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

The setup file is `src-tauri\target\release\bundle\nsis\Novaroom_0.1.0_x64-setup.exe`. In Partner Center, create a Win32 app and upload that installer. Use this listing text:

- **Short description:** Chat for AI trainers.
- **Description:** Novaroom is a Windows chat app for annotators, raters, and prompt writers. Join a topic room for coding, writing, math, or rating, or start a direct chat or a small group. Block, report, and delete are built in.
- **Age rating:** 18+.
- **Category:** Social.

When the Store page is live, a LinkedIn post can say: Novaroom is open for AI trainers on Windows. Annotators, raters, and prompt writers can join topic rooms without swapping email addresses. The Microsoft Store link is [your listing URL].

A direct download outside the Store waits until code signing is set up.

## Folder map

| Path | What it is |
|---|---|
| `src/` | Sign-in, profile, and chat screens |
| `src-tauri/` | Windows shell |
| `supabase/migrations/` | SQL to run in the Supabase project |
| `.github/workflows/release.yml` | Builds and publishes a release when a version tag is pushed |
| `.env.example` | The two values the app expects |

## If something fails

**`rustc` or `cargo` is not recognized.** Install rustup, run `rustup default stable`, and open a new terminal.

**`link.exe` was not found.** The C++ build tools are missing or the installer is still running. Install the Visual Studio 2022 Build Tools workload named above, then compile again.

**The window never opens and Vite says port 1420 is in use.** Another `npm run tauri dev` or `npm run dev` is still running. Stop it, then start once.

**Sign-in stays on preview after you created `.env`.** The URL or anon key is empty, or the app was not restarted after the file was saved.

**The code email never arrives.** Check the Magic Link template includes `{{ .Token }}`, and look in the Supabase **Authentication → Logs** for the send attempt. Also check spam.

**Start chat says no account uses that email.** With Supabase connected, the other person must complete sign-in once. Preview mode does not require that.

**Messages send but the other person does not see them live.** Re-run the messages script so `public.messages` is added to `supabase_realtime`. History still loads when they open the chat.
