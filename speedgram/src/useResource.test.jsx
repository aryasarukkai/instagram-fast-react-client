import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCallback } from 'react';
import PropTypes from 'prop-types';
import { useResource } from './useResource';

const Harness = ({ loader }) => {
  const stableLoader = useCallback(loader, [loader]);
  const resource = useResource(stableLoader);
  return (
    <div>
      {resource.loading ? <span>Loading</span> : null}
      <span>{resource.data?.label || 'Empty'}</span>
      <button type="button" onClick={() => resource.reload({ background: true })}>Sync quietly</button>
    </div>
  );
};

Harness.propTypes = { loader: PropTypes.func.isRequired };

describe('useResource background refresh', () => {
  afterEach(cleanup);

  it('keeps existing content visible during a quiet reload', async () => {
    let finishRefresh;
    const loader = vi.fn()
      .mockResolvedValueOnce({ label: 'Current messages' })
      .mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));

    render(<Harness loader={loader} />);
    expect(await screen.findByText('Current messages')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sync quietly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync quietly' }));
    expect(screen.getByText('Current messages')).toBeInTheDocument();
    expect(screen.queryByText('Loading')).not.toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);

    finishRefresh({ label: 'New messages' });
    expect(await screen.findByText('New messages')).toBeInTheDocument();
  });
});
