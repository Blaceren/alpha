type ApiLoadStateProps = {
  isLoading: boolean;
  isFallback: boolean;
};

export function ApiLoadState({ isLoading, isFallback }: ApiLoadStateProps) {
  if (isLoading) {
    return <div className="app-card-flat p-4 text-sm text-[var(--text-secondary)]">Загрузка...</div>;
  }

  if (isFallback) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Не удалось загрузить данные. Фиктивные данные не показываются; попробуйте обновить страницу.
      </div>
    );
  }

  return null;
}
