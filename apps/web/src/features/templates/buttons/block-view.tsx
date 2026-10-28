// The editor's view of the "/button" block (node `actionButton`, which keeps only `buttonId`).
// Hidden where there's no page (share-link pages); the page view may give the page with
// ButtonPageProvider, otherwise it's the page in the address.
import { NodeViewWrapper, type JSONContent, type ReactNodeViewProps } from '@carehub/editor';
import { pageUrl } from '@carehub/shared';
import { Spinner } from '@carehub/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { failureMessage } from '../template-fields';
import { useButtonsClient } from './api';
import { ButtonBlock } from './button-block';
import { useButtonPageId } from './page-id';
import { insertNextTo, type PageStepDeps } from './page-steps';
import { openSettingsFor, reportProblem, takeAdding } from './store';

export function ButtonBlockView({
  node,
  editor,
  getPos,
  updateAttributes,
  deleteNode,
}: ReactNodeViewProps) {
  const pageId = useButtonPageId();
  const navigate = useNavigate();
  const client = useButtonsClient();
  const [adding, setAdding] = useState(false);
  const buttonId = typeof node.attrs.buttonId === 'string' ? node.attrs.buttonId : null;

  // A block the "/" menu just added: make its button, then open its settings.
  useEffect(() => {
    if (buttonId || !takeAdding(editor)) return;
    if (!pageId) {
      reportProblem('Buttons can only be added to pages.');
      deleteNode();
      return;
    }
    setAdding(true);
    client.create(pageId).then(
      (button) => {
        if (editor.isDestroyed) return;
        openSettingsFor(button.id);
        updateAttributes({ buttonId: button.id });
        setAdding(false);
      },
      (error: unknown) => {
        reportProblem(failureMessage(error, 'Couldn’t add the button. Try again.'));
        if (!editor.isDestroyed) deleteNode();
      },
    );
    // Only when the block first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps = useMemo<PageStepDeps>(
    () => ({
      insertBlocks: (where, blocks: JSONContent[]) => insertNextTo(editor, getPos, where, blocks),
      openPage: (id, openIn) => {
        if (openIn === 'new_tab') window.open(pageUrl(id), '_blank', 'noopener');
        else void navigate(pageUrl(id));
      },
      openLink: (url) => {
        window.open(url, '_blank', 'noopener,noreferrer');
      },
    }),
    [editor, getPos, navigate],
  );

  const onCopied = useCallback(
    (id: string) => updateAttributes({ buttonId: id }),
    [updateAttributes],
  );

  let body = null;
  if (pageId && buttonId) {
    body = (
      <ButtonBlock
        buttonId={buttonId}
        pageId={pageId}
        editable={editor.isEditable}
        onCopied={onCopied}
        steps={steps}
      />
    );
  } else if (pageId && adding) {
    body = <Spinner label="Adding a button" />;
  } else if (pageId && editor.isEditable) {
    body = <p className="text-small text-muted">This button was removed.</p>;
  }
  return (
    <NodeViewWrapper data-action-button="" contentEditable={false}>
      {body}
    </NodeViewWrapper>
  );
}
