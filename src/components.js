import {
	ButtonStyle,
	ComponentType,
	MessageFlags,
} from 'discord-api-types/v10';

/**
 * Component for clipping a message.
 * @param {string} messageUrl - URL of the Discord message
 * @returns {import('discord-api-types/v10').APIInteractionResponseCallbackData}
 */
export const CLIP_COMPONENT = (messageUrl) => ({
	flags: MessageFlags.IsComponentsV2,
	components: [
		{
			type: ComponentType.Container,
			components: [
				{
					type: ComponentType.TextDisplay,
					content: `## Successfully Clipped Message\n\nSaved message from ${messageUrl}`,
				},
				{
					type: ComponentType.MediaGallery,
					items: [
						{
							media: {
								url: 'attachment://clip.png',
							},
						},
					],
				},
			],
		},
	],
	attachments: [
		{
			id: 0,
			filename: 'clip.png',
		},
	],
});

/**
 * Component for displaying an error message.
 * @param {string} errorId - The error ID to display, for correlating with server-side logs
 * @returns {import('discord-api-types/v10').RESTPostAPIWebhookWithTokenJSONBody}
 */
export const ERROR_COMPONENT = (errorId) => ({
	flags: MessageFlags.IsComponentsV2,
	components: [
		{
			type: ComponentType.Container,
			components: [
				{
					type: ComponentType.TextDisplay,
					content: `## Error\n\nAn unexpected error occurred while generating the clip. Please try again later.\n\nIf this keeps happening, share this error ID in the support server: \`${errorId}\``,
				},
				{
					type: ComponentType.ActionRow,
					components: [
						{
							type: ComponentType.Button,
							style: ButtonStyle.Link,
							label: 'Support Server',
							url: 'https://discord.gg/XkAHS8MkTe',
						},
					],
				},
			],
		},
	],
});
