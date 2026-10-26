'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { advanceResearch } from '@/app/actions';

export function JobPoller({ projectId, active }: { projectId: string; active: boolean }) {
  const router = useRouter();
  const [label, setLabel] = useState('Starting the next search');

  useEffect(() => {
    if (!active) return;
    let stop = false;
    async function tick() {
      if (stop) return;
      const result = await advanceResearch(projectId);
      if (stop) return;
      setLabel(result.label);
      router.refresh();
      if (result.status === 'running' || result.status === 'queued') {
        window.setTimeout(tick, 600);
      }
    }
    void tick();
    return () => {
      stop = true;
    };
  }, [active, projectId, router]);

  if (!active) return null;
  return (
    <p className="progress" role="status">
      {label}
    </p>
  );
}
