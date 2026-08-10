import sys
from pathlib import Path

# Allow `import backend.effi...` when running pytest from anywhere in the repo.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
