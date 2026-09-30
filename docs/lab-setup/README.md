# Lab setup guide

`DetectKB-Lab-Setup.docx` / `.pdf` (Persian): how to build a detection test lab on vSphere
(Splunk, a Windows victim with Sysmon and the Universal Forwarder, Atomic Red Team) and how
DetectKB connects to it.

## Rebuilding

```bash
npm install
npm run build        # writes DetectKB-Lab-Setup.docx
soffice --headless --convert-to pdf DetectKB-Lab-Setup.docx
```

The two diagrams come from `scripts/diagrams.html` (needs the Vazirmatn font and Playwright):
`npm run diagrams` writes `img/topology.png` and `img/flow.png`; save them as `.jpg` next to
them and update the sizes at the top of `build.js` if they changed.
