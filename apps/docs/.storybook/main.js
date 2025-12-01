import { dirname, join, path, resolve } from "path";

function getAbsolutePath(value) {
	return dirname(require.resolve(join(value, "package.json")));
}

const config = {
	stories: ["../stories/*.stories.tsx", "../stories/**/*.stories.tsx"],
	addons: [
		getAbsolutePath("@storybook/addon-links"),
		getAbsolutePath("@storybook/addon-essentials"),
	],
	framework: {
		name: getAbsolutePath("@storybook/react-vite"),
		options: {},
	},

	core: {},

	async viteFinal(config, { configType }) {
		// customize the Vite config here
		return {
			...config,
			define: { "process.env": {} },
			resolve: {
				alias: [
					{
						find: "ui",
						// ...config.resolve.alias,
						replacement: resolve(__dirname, "../../../packages/ui/"),
						// "@repo/ui": path.resolve(__dirname, "../../../packages/ui/"),
					},
				],
			},
		};
	},

	docs: {
		autodocs: true,
	},
};

export default config;
