import { Button2 } from "@repo/ui/button2";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
	title: "Zc8/Button",
	component: Button2,
	tags: ["autodocs"],
} satisfies Meta<typeof Button2>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
	args: {
		children: "I am a zc8 button.",
	},
};
