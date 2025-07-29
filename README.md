# Bumble's Paywall is a Joke - A Chrome Extension to See Who's Already Liked You 👀

You're not ugly, you're just inefficient.

I was riding the high from dismantling Hinge's API and decided to take a peek at Bumble. I was wondering why my match queue felt like a graveyard. Turns out, Bumble's biggest feature, the "Beeline" (where they show you everyone who's already swiped right on you), isn't protected by some server-side fortress. It's literally just hidden with CSS.

They send the data directly to your browser and then charge you money to see it. Let that sink in.

### The WTF Moment: They Send You The `their_vote` Variable 🤦

I'm not even joking.

When your browser requests the list of potential matches, the response from Bumble's server includes a beautiful little key for each user: `their_vote`.

* `their_vote: 2` means they already swiped right on you. ❤️
* `their_vote: 3` means they swiped left. 💔
* `their_vote: 1` means they haven't seen you yet. 🤷

They send you the answer key and then ask you to pay to reveal it. This is not a hack. This is just reading the data they willingly give you. It took more time to write the `manifest.json` than to find the vulnerability.

### The Strategic Advantage (aka Why Pay for Bumble Premium?) 🏆

Bumble wants you to swipe blindly, wasting your time on people who may have already rejected you. This extension kills that. It gives you back the power by revealing who has *already liked you* directly on their profile card as you're swiping.

1.  **Guaranteed Matches:** See that green "[LIKED YOU] ❤️" badge? Swipe right. Boom. Instant match. You can spend your entire session only swiping on guaranteed connections.
2.  ~~**Dodge the Rejection:** See a red "[REJECTED YOU] 💔" badge? You can swipe left and save yourself the emotional damage. Or swipe right for the story. You do you.~~
3.  **Stop Wasting Time:** No more guessing games. You can now allocate your swipes with god-tier precision.

### Disclaimer 🙏

This is for educational purposes. It demonstrates how some companies implement "premium" features. Don't be a weirdo. Don't use this to harass people. I am not responsible if you get banned, get your heart broken, or end up on a date with your second cousin twice removed.

To Bumble: If you're gonna C&D this, at least fix your API. Don't send the data to the client if you want people to pay for it. Also, I'm open to freelance security consulting. Call me. 🤙

### How It Works 🔥

This isn't some complex attack. It's literally just two scripts.

* `page.js`: This tiny script injects itself into the Bumble web app and uses basic function patching to listen to the `fetch` and `XMLHttpRequest` requests. When it sees the `SERVER_GET_ENCOUNTERS` API call, it grabs the results.
* `content.js`: This script listens for the data from `page.js`. It then reads the name and age from the profile you're currently viewing and cross-references it with the data it just received. It then injects a simple, color-coded badge next to their name. That's it. It's embarrassingly simple.

### Setup & Usage

You're a dev. You know this.

1.  Clone this repo or download it as a ZIP.
2.  Open Chrome and go to `chrome://extensions`.
3.  Flick the "Developer mode" switch in the top-right corner.
4.  Click "Load unpacked" and select the folder you just downloaded.
5.  Go to `bumble.com/app`, open your dev tools so you can see the magic, and start swiping with your newfound omniscience.

### To-Do (Because Why Stop Here?)

* [X] Auto-swipe right only on people who have already liked you. Why click when a script can do it for you? (Closed source)
* [X] Keep a history of everyone you've seen. A personal burn book, if you will. (Closed source)

Go cause some chaos. Or find love. I'm not your dad.