import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBrokenLinks } from '@/lib/api';
import { Link2Off } from 'lucide-react';

interface BrokenLink {
  sourceSlug: string;
  sourceTitle: string;
  brokenTitle: string;
}

export function BrokenLinksPage() {
  const [brokenLinks, setBrokenLinks] = useState<BrokenLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBrokenLinks()
      .then(setBrokenLinks)
      .catch(() => setBrokenLinks([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link2Off className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Broken Links</h1>
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Loading...</div>
      ) : brokenLinks.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
          <Link2Off className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm font-medium">No broken links found.</p>
          <p className="text-muted-foreground/60 text-xs mt-1">
            All <code>[[wiki links]]</code> resolve to existing pages.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <p className="text-sm text-muted-foreground">
              {brokenLinks.length} broken link{brokenLinks.length !== 1 ? 's' : ''} found across your knowledge base.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-5 py-3 font-medium text-muted-foreground">Source Page</th>
                  <th className="text-left px-5 py-3 font-medium text-muted-foreground">Broken Link</th>
                  <th className="text-left px-5 py-3 font-medium text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {brokenLinks.map((bl, idx) => (
                  <tr
                    key={`${bl.sourceSlug}-${bl.brokenTitle}-${idx}`}
                    className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <Link
                        to={`/pages/${bl.sourceSlug}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {bl.sourceTitle}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <span className="wiki-link-broken font-mono text-xs px-1.5 py-0.5 rounded">
                        [[{bl.brokenTitle}]]
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        to={`/pages/new?title=${encodeURIComponent(bl.brokenTitle)}`}
                        className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                      >
                        Create page
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
