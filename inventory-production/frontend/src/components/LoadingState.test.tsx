import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LoadingState } from './LoadingState';

afterEach(cleanup);

describe('LoadingState', () => {
  it('announces its purpose and renders the requested number of rows', () => {
    const view = render(<LoadingState rows={3} label="Loading assets" />);
    expect(view.getByLabelText('Loading assets')).toBeTruthy();
    expect(view.container.querySelectorAll('.skeleton-row')).toHaveLength(3);
  });
});
