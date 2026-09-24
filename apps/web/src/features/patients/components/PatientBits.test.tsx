import { render, screen } from '@testing-library/react';
import { AgeGender, AllergyAlert } from './PatientBits';

describe('patient display helpers', () => {
  it('flags estimated ages', () => {
    render(<AgeGender patient={{ age: 45, gender: 'FEMALE', dobEstimated: true }} />);
    expect(screen.getByText(/45 y/)).toHaveTextContent('45 y (estimated) · Female');
  });

  it('announces allergies as an alert and hides when none', () => {
    const { rerender, container } = render(
      <AllergyAlert allergies={[{ id: '1', allergen: 'Penicillin', reaction: null, severity: 'SEVERE', createdAt: '' }]} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Penicillin');
    rerender(<AllergyAlert allergies={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
