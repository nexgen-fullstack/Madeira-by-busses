# Build for the phone app (`vite build --mode app`, see apps/mobile).
# The app downloads newer timetables from the website in the background; the
# second address is the same file on the gh-pages branch, for when GitHub Pages
# is not serving that branch.
VITE_REMOTE_DATA=https://nexgen-fullstack.github.io/Madeira-by-busses/data/network.json https://raw.githubusercontent.com/nexgen-fullstack/Madeira-by-busses/gh-pages/data/network.json
