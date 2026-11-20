# Studydot

A simple study app: make sets of words or questions with their answers, then learn
them with flashcards or a quiz. Works on phones and computers.

- Three sections: **Sets** (your study sets), **Study** (pick a set and a way to study), **Profile** (account and settings).
- Free accounts (email and password, via Firebase project `studydot-app`) save sets
  to every device. Without an account, sets are saved in the browser.

## Running it locally

There's no build step. Serve the folder and open it:

```bash
python3 -m http.server 8780
```

## Files

- `index.html`, `style.css`, `app.js`: the app
- `sync.js`: accounts and syncing
- `firestore.rules`: who can read and write what (`firebase deploy --only firestore:rules`)
