import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "wiki_lint.py"


class WikiLintTests(unittest.TestCase):
    def test_index_alias_link_counts_as_an_index_entry(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            vault = Path(temp_dir)
            (vault / "SCHEMA.md").write_text(
                "## Tag Taxonomy\n- standards\n## Page Thresholds\n",
                encoding="utf-8",
            )
            (vault / "index.md").write_text(
                "- [[alpha|team/workflow/alpha]]\n- [[beta]]\n",
                encoding="utf-8",
            )
            frontmatter = "---\ntitle: {title}\ncreated: 2026-09-15\nupdated: 2026-09-15\ntype: concept\ntags: [standards]\nsources: []\n---\n\n"
            (vault / "alpha.md").write_text(frontmatter.format(title="Alpha") + "[[beta]] [[alpha]]\n", encoding="utf-8")
            (vault / "beta.md").write_text(frontmatter.format(title="Beta") + "[[alpha]] [[beta]]\n", encoding="utf-8")

            result = subprocess.run([sys.executable, str(SCRIPT), str(vault)], capture_output=True, text=True, check=False)

            self.assertEqual(result.returncode, 0, result.stdout)


if __name__ == "__main__":
    unittest.main()
