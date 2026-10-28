// Made-up buttons and a made-up Tickets database for the buttons tests.
import type { DatabaseMeta, Property } from '@carehub/databases';
import type { ButtonResponse, ButtonSettings } from '@carehub/extras/templates/buttons';

export const PAGE_ID = '0b8e7f0e-3d0a-4c1e-8a59-9a7c6f0d4e21';
export const BUTTON_ID = '5a0c7e1d-2b3f-4a6e-9c8d-7f1e2d3c4b5a';
export const COPY_ID = '6b1d8f2e-3c4a-4b7f-8d9e-0a1b2c3d4e5f';
export const RUN_ID = '7c2e9a3f-4d5b-4c8a-9e0f-1b2c3d4e5f6a';
export const TICKETS_ID = '8d7c6b5a-4e3f-4a2b-9c1d-0e9f8a7b6c5d';
export const OTHER_PAGE_ID = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';

/** Property, option and template IDs of the Tickets database. */
export const ID = {
  name: 'bdd640fb-0667-4ad1-9c80-317fa3b1799d',
  status: '23b8c1e9-3924-46de-beb1-3b9046685257',
  tags: 'bd9c66b3-ad3c-4d6d-9a3d-1fa7bc8960a9',
  due: '972a8469-1641-4f82-8b9d-2434e465e150',
  owner: '17fc695a-07a0-4a6e-8822-e8f36c031199',
  hours: '9a1de644-815e-46d1-bb8f-aa1837f8a88b',
  urgent: 'b74d0fb1-32e7-4629-8fad-c1a606cb0fb3',
  notes: '6b65a6a4-8b81-48f6-b38a-088ca65ed389',
  new: '47378190-96da-4dac-b2ff-5d2a386ecbe0',
  done: 'c241330b-01a9-471f-9e8a-774bcf36d58b',
  chat: '6c307511-b2b9-437a-a8df-6ec4ce4a2bbd',
  phone: '371ecd7b-27cd-4130-8722-9389571aa876',
  intake: '1a2a73ed-562b-4f79-8374-59eef50bea63',
};

const property = (id: string, name: string, config: Record<string, unknown>) =>
  ({ id, name, description: '', rowPage: 'always', config }) as unknown as Property;

export const TICKETS = {
  id: TICKETS_ID,
  title: 'Tickets',
  icon: null,
  properties: [
    property(ID.name, 'Name', { type: 'title' }),
    property(ID.status, 'Status', {
      type: 'status',
      defaultOptionId: ID.new,
      options: [
        { id: ID.new, name: 'New', color: 'blue', group: 'todo' },
        { id: ID.done, name: 'Done', color: 'green', group: 'complete' },
      ],
    }),
    property(ID.tags, 'Tags', {
      type: 'multi_select',
      options: [
        { id: ID.chat, name: 'Chat', color: 'purple' },
        { id: ID.phone, name: 'Phone', color: 'orange' },
      ],
    }),
    property(ID.due, 'Due', { type: 'date', format: 'relative', timeFormat: '12h' }),
    property(ID.owner, 'Owner', { type: 'person', single: false, notify: false }),
    property(ID.hours, 'Hours', { type: 'number' }),
    property(ID.urgent, 'Urgent', { type: 'checkbox' }),
    property(ID.notes, 'Notes', { type: 'text' }),
  ],
  templates: [{ id: ID.intake, name: 'Intake', icon: null, values: {} }],
} as unknown as DatabaseMeta;

export function settings(fields: Partial<ButtonSettings> = {}): ButtonSettings {
  return {
    label: 'Start intake',
    icon: '🚀',
    color: 'default',
    who: 'editors',
    actions: [{ kind: 'open_link', url: 'https://example.org/intake' }],
    ...fields,
  };
}

export function buttonResponse(fields: Partial<ButtonResponse> = {}): ButtonResponse {
  return {
    id: BUTTON_ID,
    pageId: PAGE_ID,
    settings: settings(),
    sentence: 'When pressed: open example.org.',
    canEdit: true,
    canPress: true,
    reason: null,
    runs: [],
    ...fields,
  };
}
