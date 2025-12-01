import { Button } from "@repo/ui/button";
import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof Button> = {
	component: Button,
	argTypes: {
		type: {
			control: { type: "radio" },
			options: ["button", "submit", "reset"],
		},
	},
};

export default meta;

type Story = StoryObj<typeof Button>;

/*
 *👇 Render functions are a framework specific feature to allow you control on how the component renders.
 * See https://storybook.js.org/docs/react/api/csf
 * to learn how to use render functions.
 */
export const Primary: Story = {
	render: (props) => (
		<Button
			{...props}
			onClick={(): void => {
				// eslint-disable-next-line no-alert -- alert for demo
				alert("Hello from Turborepo!");
			}}
		>
			Hello
		</Button>
	),
	name: "Button",
	args: {
		children: "hip",
		type: "button",
		style: {
            "color": "blue",
            "border": "1px solid white",
            "padding": 10,
            "borderRadius": 10
        },
	},
};

export const Kn: Story = {
    args: {
        children: "hi",
        type: "button",

        style: {
            "color": "blue",
            "border": "1px solid white",
            "padding": 10,
            "borderRadius": 10
        }
    },

    render: props => (<Button
        {...props}
        onClick={(): void => {
            alert("Hello from Turborepo!");
        }}>Hello
                </Button>),

    name: "Button"
};
