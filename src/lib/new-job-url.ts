/**
 * The new-job wizard (`/projects/new`) opens with the client already chosen when it is given `?clientId=`
 * (`NewJobWizard` reads it once). Every `New job for client…` entry point builds its URL here.
 */
export const newJobForClientHref = (clientId: string): string => `/projects/new?clientId=${encodeURIComponent(clientId)}`;
