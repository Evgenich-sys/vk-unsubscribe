(async () => {
  if (window.vkLeaveAll) return console.warn("Уже запущено.");

  const state = window.vkLeaveAll = { stop: false };
  const seen = new Set();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => el.getClientRects().length > 0;
  const text = el => (el.innerText || el.value || "")
    .replace(/\s+/g, " ").trim();

  const warning =
    "Это закрытое сообщество. Если вы отпишетесь, попасть " +
    "обратно, возможно, будет непросто. Отписаться от сообщества?";

  let done = 0;

  function guard(allowClosed = false) {
    if (state.stop) throw Error("Остановлено пользователем.");
    if (location.pathname !== "/groups/my_all_groups") {
      throw Error("Страница изменилась.");
    }

    const dialogs = [...document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], .box_layout'
    )].filter(el =>
      visible(el) &&
      !el.closest('[data-testid="dropdownactionsheet"]')
    );

    const roots = dialogs.filter(el =>
      !dialogs.some(other => other !== el && other.contains(el))
    );

    if (!roots.length) return null;

    if (
      allowClosed &&
      roots.length === 1 &&
      text(roots[0]).includes(warning)
    ) {
      return roots[0];
    }

    throw Error("Неизвестное окно или проверка ВК — проверьте вручную.");
  }

  async function waitFor(check, allowClosed = false) {
    const until = Date.now() + 10000;
    let warningConfirmed = false;

    while (Date.now() < until) {
      const dialog = guard(allowClosed);

      if (dialog && !warningConfirmed) {
        const buttons = [...dialog.querySelectorAll(
          'button, [role="button"], input[type="button"]'
        )].filter(el => visible(el) && text(el) === "Отписаться");

        if (buttons.length !== 1) {
          throw Error("Не удалось однозначно найти подтверждение.");
        }

        warningConfirmed = true;
        buttons[0].click();
      }

      const result = check();
      if (result && !dialog) return result;
      await sleep(150);
    }

    throw Error("Не удалось подтвердить отписку. Дальше не продолжаю.");
  }

  function nextGroup() {
    for (const button of document.querySelectorAll(
      '[data-testid="desktop_group_item_button"]'
    )) {
      const row = button.closest("a[href]");
      if (!row || /Подписаться|Подать заявку/.test(text(row))) continue;

      const path = new URL(row.href).pathname;
      if (!seen.has(path)) {
        return {
          button, row, path,
          name: (row.innerText || "").split("\n")[0].trim()
        };
      }
    }
  }

  try {
    guard();

    if (!confirm(
      "Отписаться от всех сообществ, включая закрытые?\n\n" +
      "Предупреждения о выходе будут подтверждаться автоматически. " +
      "Вернуться в закрытые группы может быть невозможно."
    )) return;

    while (true) {
      guard();
      let group = nextGroup();

      if (!group) {
        for (let attempt = 0; attempt < 8 && !group; attempt++) {
          guard();
          window.scrollTo(0, document.documentElement.scrollHeight);
          await sleep(1200);
          group = nextGroup();
        }

        if (!group) {
          console.log("Новых групп не найдено. Проверьте остаток после обновления.");
          break;
        }
      }

      seen.add(group.path);
      group.button.scrollIntoView({ block: "center" });

      group.button.dispatchEvent(new MouseEvent("mouseover", {
        bubbles: true,
        relatedTarget: document.body
      }));

      const action = await waitFor(() => {
        const expanded = [...document.querySelectorAll(
          '[data-testid="desktop_group_item_button"][aria-expanded="true"]'
        )];

        if (expanded.length !== 1 || expanded[0] !== group.button) return;

        const items = [...document.querySelectorAll(
          '[data-testid="dropdownactionsheet-item"]'
        )].filter(el => visible(el) && text(el) === "Отписаться");

        return items.length === 1 ? items[0] : null;
      });

      action.click();

      await waitFor(() =>
        group.row.isConnected &&
        /(^|\s)(Подписаться|Подать заявку)(\s|$)/.test(text(group.row)),
        true
      );

      console.log(`${++done}. Отписка: ${group.name}`);
      await sleep(700);
    }
  } catch (error) {
    console.warn("Остановка:", error.message);
  } finally {
    delete window.vkLeaveAll;
    console.log(
      `Интерфейс подтвердил отписок за этот запуск: ${done}. ` +
      "Обновите страницу для проверки."
    );
  }
})();
