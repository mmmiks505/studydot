# Studydot

A simple study app: make sets of words or questions with their answers, then learn
them with flashcards or a quiz. Works on phones and computers.
Live at https://mmmiks505.github.io/studydot/

- Four sections: **Sets** (your study sets), **Study** (pick a set and a way to study), **SAT** (ready-made SAT vocab and math sets), **Profile** (account and settings).
- Three ways to study: Flashcards, Quiz, and Write (type the answer).
- Language sets for Spanish, French, Latin and Mandarin: accent buttons, read-aloud, and for Mandarin a Pinyin box on each card (tone numbers like `ni3` turn into tone marks).
- Free accounts (email and password, via Firebase project `studydot-app`) save sets
  to every device. Without an account, sets are saved in the browser.

## Running it locally

There's no build step. Serve the folder and open it:

```bash
python3 -m http.server 8780
```

## Files

- `index.html`, `style.css`, `app.js`: the app
- `sat.js`: the ready-made SAT sets
- `sync.js`: accounts and syncing
- `firestore.rules`: who can read and write what (`firebase deploy --only firestore:rules`)
