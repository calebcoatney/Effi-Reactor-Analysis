#!/usr/bin/env bash
#
# Effi Reactor Analysis — one-click updater.
#
# Pulls the latest code and reinstalls it into the conda environment.
# Lives inside the repo, so it finds its own location — you can run it
# from anywhere, or double-click update.command (macOS) / update.bat (Windows).
#
#   bash update.sh              # update using the default env name (effi-env)
#   bash update.sh my-env-name  # update using a different env

set -uo pipefail

ENV_NAME="${1:-effi-env}"

# --- locate the repo: the directory this script lives in -------------------
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO" || { echo "Could not enter $REPO"; exit 1; }

say()  { printf '\n%s\n' "$*"; }
fail() { printf '\nERROR: %s\n\n' "$*"; read -r -p "Press Enter to close..." _; exit 1; }

say "Effi Reactor Analysis — updater"
echo  "Repository: $REPO"
echo  "Environment: $ENV_NAME"

# --- sanity: is this actually the repo? -----------------------------------
[ -f pyproject.toml ] || fail "pyproject.toml not found in $REPO. This does not look like the Effi folder."

if [ ! -d .git ]; then
    cat <<EOF

ERROR: this folder has no git repository in it, so there is nothing to update from.

  $REPO

This usually means the folder came from GitHub's "Download ZIP" button rather
than from 'git clone'. A downloaded copy has no link back to GitHub, so neither
this script nor 'git pull' can update it.

To fix it once, get a real clone (this does NOT touch your existing folder or
any data in it):

  cd ~
  git clone https://github.com/calebcoatney/Effi-Reactor-Analysis.git
  cd Effi-Reactor-Analysis
  conda run -n $ENV_NAME python -m pip install .

After that, updating is just double-clicking update.command in the new folder.
The old folder can be deleted once you have checked you keep any results saved
inside it.

EOF
    read -r -p "Press Enter to close..." _
    exit 1
fi

# --- find conda -----------------------------------------------------------
CONDA=""
if command -v conda >/dev/null 2>&1; then
    CONDA="$(command -v conda)"
else
    for base in "$HOME/miniforge3" "$HOME/miniconda3" "$HOME/anaconda3" \
                "$HOME/Miniconda3" "$HOME/Anaconda3" \
                "/opt/miniconda3" "/opt/anaconda3" \
                "/c/ProgramData/Anaconda3" "/c/ProgramData/Miniconda3" \
                "${LOCALAPPDATA:-}/Continuum/anaconda3"; do
        for exe in "$base/bin/conda" "$base/Scripts/conda.exe" "$base/condabin/conda.bat"; do
            [ -x "$exe" ] && { CONDA="$exe"; break 2; }
        done
    done
fi
[ -n "$CONDA" ] || fail "Could not find conda. Open an Anaconda Prompt (Windows) or a terminal where 'conda' works, then run: bash update.sh"

# --- sanity: does the environment exist? ----------------------------------
if ! "$CONDA" env list | awk '{print $1}' | grep -qx "$ENV_NAME"; then
    say "Environments found:"
    "$CONDA" env list
    fail "No conda environment named '$ENV_NAME'. Re-run as: bash update.sh <your-env-name>"
fi

# --- refuse to clobber local edits ----------------------------------------
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    say "You have local changes to tracked files:"
    git status --short --untracked-files=no
    fail "Pulling would overwrite these. Send Caleb this list, or run 'git stash' if you know you don't need them."
fi

BEFORE="$(git rev-parse --short HEAD)"

# --- pull -----------------------------------------------------------------
say "[1/2] Downloading the latest version..."
git pull --ff-only || fail "git pull failed. Check your internet connection, then send Caleb the message above."

AFTER="$(git rev-parse --short HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
    echo "Already up to date ($AFTER) — reinstalling anyway to be safe."
else
    echo "Updated $BEFORE -> $AFTER:"
    git log --oneline "$BEFORE..$AFTER" | sed 's/^/    /'
fi

# --- reinstall (required: this is a copy install, not an editable one) -----
say "[2/2] Installing into '$ENV_NAME'..."
"$CONDA" run -n "$ENV_NAME" --no-capture-output python -m pip install . --quiet \
    || fail "Install failed. Send Caleb the message above."

say "Done. Start the app by running:  effi-analysis"
echo
read -r -p "Press Enter to close..." _
