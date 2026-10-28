import { closeRemindMe, useRemindMeRequest } from './remindMe';
import { RemindMeDialog } from './RemindMeDialog';

/** Shows Remind me when a feature opens it. The app shell renders it once (the overlays slot). */
export function RemindMeOverlay() {
  const request = useRemindMeRequest();
  if (!request) return null;
  const { id, target, returnFocus } = request;
  return (
    <RemindMeDialog
      key={id}
      target={target}
      onClose={closeRemindMe}
      onCloseAutoFocus={(event) => {
        // Back to what opened it. If that's gone, the dialog picks the place itself.
        if (!returnFocus?.isConnected) return;
        event.preventDefault();
        returnFocus.focus();
      }}
    />
  );
}
