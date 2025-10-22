export default function AdditionalPage() {
  return (
    <s-page heading="Extra pagina">
      <s-section heading="Meerdere pagina's">
        <s-paragraph>
          De app-sjabloon wordt geleverd met een extra pagina die laat zien hoe je
          meerdere pagina's maakt binnen de app-navigatie met behulp van{" "}
          <s-link
            href="https://shopify.dev/docs/apps/tools/app-bridge"
            target="_blank"
          >
            App Bridge
          </s-link>
          .
        </s-paragraph>
        <s-paragraph>
          Om je eigen pagina te maken en deze te tonen in de app-navigatie, voeg je
          een pagina toe in <code>app/routes</code> en een link ernaartoe in het{" "}
          <code>&lt;ui-nav-menu&gt;</code>-component in{" "}
          <code>app/routes/app.jsx</code>.
        </s-paragraph>
      </s-section>
      <s-section slot="aside" heading="Bronnen">
        <s-unordered-list>
          <s-list-item>
            <s-link
              href="https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav"
              target="_blank"
            >
              Best practices voor app-navigatie
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
