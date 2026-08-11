import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImportIssue } from '../types';
import { ImportIssueCard } from './ImportPage';

afterEach(cleanup);

const approvedArchitectures = [
  { id: 1, value: 'BLACKWELL', label: 'Blackwell' },
  { id: 2, value: 'ADA', label: 'Ada' },
];

function issue(overrides: Partial<ImportIssue> = {}): ImportIssue {
  return {
    fieldKey: 'board_architecture',
    fieldLabel: 'Board Architecture',
    severity: 'ERROR',
    code: 'LOOKUP_VALUE_UNRECOGNIZED',
    message: 'Board Architecture value "AMPERE" is not approved.',
    sourceValue: 'AMPERE',
    lookupKey: 'BOARD_ARCHITECTURE',
    lookupName: 'Board Architecture',
    approvedValues: approvedArchitectures,
    suggestedValues: ['Blackwell'],
    ...overrides,
  };
}

describe('ImportIssueCard', () => {
  it('shows approved values and corrects the staged row without a new upload', () => {
    let corrected = '';
    const view = render(
      <MemoryRouter>
        <ul>
          <ImportIssueCard
            canApproveLookups
            onCorrect={(value) => { corrected = value; }}
            issue={issue()}
          />
        </ul>
      </MemoryRouter>,
    );

    expect(view.getByText('Board Architecture')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /view approved values \(2\)/i }));
    fireEvent.click(view.getByRole('button', { name: 'Blackwell' }));
    expect(corrected).toBe('Blackwell');
  });

  it('lets an authorized operator add a rejected controlled value with a reason', () => {
    let approvalReason = '';
    const view = render(
      <MemoryRouter>
        <ul>
          <ImportIssueCard
            canApproveLookups
            onApprove={(reason) => { approvalReason = reason; }}
            issue={issue({
              fieldKey: 'pool_team',
              fieldLabel: 'Pool/Team',
              message: 'Pool/Team value "Colossus GPU Platform Team" is not approved.',
              sourceValue: 'Colossus GPU Platform Team',
              lookupKey: 'POOL_TEAM',
              lookupName: 'Pool/Team',
              approvedValues: [{ id: 3, value: 'IMARGULIS_STAFF', label: '#imargulis-staff' }],
              suggestedValues: [],
            })}
          />
        </ul>
      </MemoryRouter>,
    );

    fireEvent.click(view.getByRole('button', { name: /add as new value/i }));
    fireEvent.change(view.getByLabelText(/reason/i), { target: { value: 'Approved team for GPU operations.' } });
    fireEvent.click(view.getByRole('button', { name: /add value and revalidate/i }));
    expect(approvalReason).toBe('Approved team for GPU operations.');
  });

  it('distinguishes an empty controlled list from an unmapped profile field', () => {
    const view = render(
      <MemoryRouter>
        <ul>
          <ImportIssueCard
            canApproveLookups
            issue={issue({ approvedValues: [], suggestedValues: [] })}
          />
        </ul>
      </MemoryRouter>,
    );

    expect(view.getByText('AMPERE')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /view approved values \(0\)/i }));
    expect(view.getByText(/No approved values are configured for this field/i)).toBeTruthy();
    expect(view.getByRole('button', { name: /add as new value/i })).toBeTruthy();
    expect(view.queryByRole('button', { name: /repair profile/i })).toBeNull();
  });

  it('offers approved relationship values without allowing relationship creation in import', () => {
    let corrected = '';
    const view = render(
      <MemoryRouter>
        <ul>
          <ImportIssueCard
            canApproveLookups
            onCorrect={(value) => { corrected = value; }}
            issue={issue({
              fieldKey: 'owner',
              fieldLabel: 'Owner / Assignee',
              code: 'OWNER_NOT_RECOGNIZED',
              message: 'Owner / Assignee does not match a team member.',
              sourceValue: 'Gaurav M',
              lookupKey: undefined,
              lookupName: 'Team members',
              approvedValues: [{ id: 10, value: 'Gaurav Mehta', label: 'Gaurav Mehta' }],
              suggestedValues: ['Gaurav Mehta'],
            })}
          />
        </ul>
      </MemoryRouter>,
    );

    fireEvent.click(view.getByRole('button', { name: /Gaurav Mehta/i }));
    expect(corrected).toBe('Gaurav Mehta');
    expect(view.queryByRole('button', { name: /add as new value/i })).toBeNull();
  });

  it('tells regular users who can add a controlled value', () => {
    const view = render(
      <MemoryRouter>
        <ul>
          <ImportIssueCard canApproveLookups={false} issue={issue()} />
        </ul>
      </MemoryRouter>,
    );

    expect(view.getByText(/A Super User or Privileged Administrator can add/i)).toBeTruthy();
    expect(view.queryByRole('button', { name: /add as new value/i })).toBeNull();
  });

  it('keeps Notes as optional free text instead of a controlled-list issue', () => {
    const view = render(
      <MemoryRouter>
        <ul>
          <ImportIssueCard
            canApproveLookups
            issue={issue({
              fieldKey: 'notes',
              fieldLabel: 'Notes',
              severity: 'WARNING',
              code: 'OPTIONAL_EMPTY',
              message: 'Notes was not provided.',
              sourceValue: undefined,
              lookupKey: undefined,
              lookupName: undefined,
              approvedValues: undefined,
              suggestedValues: undefined,
            })}
          />
        </ul>
      </MemoryRouter>,
    );

    expect(view.getByText('Notes was not provided.')).toBeTruthy();
    expect(view.queryByRole('button', { name: /approved values/i })).toBeNull();
  });
});
